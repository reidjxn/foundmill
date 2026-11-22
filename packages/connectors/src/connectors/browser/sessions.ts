/**
 * The hosted browser's sessions. Only the gateway holds one: it drives the page through a `BrowserDriver` (the hosted
 * provider in live mode, recorded pages in mock mode), one session per project per site, and it is what the founder
 * watches, takes over, hands back and stops.
 *
 * shortcut: sessions live in this process's memory, so the gateway must run as one instance for the browser; upgrade to
 * a shared store (the provider's session id in Redis, reconnecting on demand) before the gateway is scaled out.
 */
import { randomBytes } from "node:crypto";
import { AppError } from "@foundmill/shared";
import { BROWSER_LIMITS } from "@foundmill/config";
import type { BrowserSite } from "../../browser-sites";
import type { PageElement, PageForm, StepAction } from "./classify";

export interface RawSnapshot {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
  forms: PageForm[];
  /** The page is a sign-in wall or a bot check. */
  needsFounder: "sign_in" | "captcha" | null;
}

export interface BrowserDriver {
  /** A new, empty saved sign-in at the provider. */
  createContext(): Promise<string>;
  /** Deletes a saved sign-in at the provider. True when it is gone (deleted now, or already missing). */
  deleteContext(contextId: string): Promise<boolean>;
  contextExists(contextId: string): Promise<boolean>;
  /** Starts a session on the saved sign-in. `save`: what the session does is written back to it when it closes (the founder's sign-in). */
  open(input: { businessId: string; site: BrowserSite; contextId: string; minutes: number; save: boolean }): Promise<{ id: string; liveViewUrl: string | null }>;
  /** Opens an address; answers where the page ended up. */
  goto(id: string, url: string): Promise<string>;
  snapshot(id: string): Promise<RawSnapshot>;
  /**
   * Acts on the element at `index` of the newest snapshot; answers where the page is afterwards. `expect` is that
   * element as it was read: a driver on a live page refuses (409) when the element there now is not the same one, so
   * what is pressed is what was classified.
   */
  act(id: string, step: { action: StepAction; index: number; expect: { role: string; label: string }; value?: string; file?: { name: string; bytes: Uint8Array } }): Promise<string>;
  screenshot(id: string): Promise<Uint8Array | null>;
  /** The saved sign-in a founder's own session ends with, to be sealed; absent when the provider keeps it (`contextId`). */
  exportState?(id: string): Promise<string>;
  close(id: string): Promise<void>;
}

export type HoldReason = "founder" | "request" | "hard_gate" | "sign_in";

export interface BrowserSession {
  businessId: string;
  site: BrowserSite;
  driverId: string;
  contextId: string;
  liveViewUrl: string | null;
  startedAt: number;
  steps: number;
  /** How many times the page was read in this session. */
  seq: number;
  /**
   * A random value for the newest read; a ref carries it (`p<nonce>e<index>`). So a ref names one element of one read
   * and nothing else: an approval or a "this already ran" answer for it can never be spent on another page or session.
   */
  nonce: string;
  snap: RawSnapshot | null;
  /** Set while the founder has the page: the agent's steps wait. */
  held: { why: HoldReason; note: string; since: number } | null;
  agentId: string | null;
  billedAt: number;
  /** Cost not yet booked, in fractions of a minor unit. */
  carry: number;
}

/** What the founder's screens are told about a session. Never the provider's ids. */
export interface BrowserSessionView {
  siteKey: string;
  siteName: string;
  liveViewUrl: string | null;
  url: string | null;
  startedAt: string;
  steps: number;
  held: { why: HoldReason; note: string } | null;
  signIn: boolean;
}

export const REF_RE = /^p([0-9a-f]{8})e(\d{1,4})$/;
export const refOf = (nonce: string, index: number): string => `p${nonce}e${index}`;
export const parseRef = (ref: string): { nonce: string; index: number } | null => {
  const m = REF_RE.exec(ref);
  return m ? { nonce: m[1]!, index: Number(m[2]) } : null;
};
/** Most sessions one project runs at once, so one project cannot hold every slot. */
export const SESSIONS_PER_PROJECT = 2;

export const SESSION_CHECKPOINT = "The browser session reached its limit and was closed. This is a checkpoint, not a failure: report what is set and what is left, and the next session continues from there.";

export class BrowserSessions {
  private readonly sessions = new Map<string, BrowserSession>();
  constructor(
    public readonly driver: BrowserDriver,
    private readonly now: () => Date = () => new Date(),
    private readonly limits: Record<"sessionMinutes" | "sessionSteps" | "signInMinutes" | "maxConcurrentSessions" | "costMinorPerHour", number> = BROWSER_LIMITS,
  ) {}

  private key = (businessId: string, siteKey: string) => `${businessId}:${siteKey}`;

  get(businessId: string, siteKey: string): BrowserSession | null {
    return this.sessions.get(this.key(businessId, siteKey)) ?? null;
  }

  /** Ends sessions past their time limit: an abandoned sign-in or a run that stopped must not hold a slot. */
  private async prune(): Promise<void> {
    const at = this.now().getTime();
    const over = [...this.sessions.values()].filter((s) => at - s.startedAt > (s.held?.why === "sign_in" ? this.limits.signInMinutes : this.limits.sessionMinutes) * 60_000 + 60_000);
    for (const s of over) {
      this.sessions.delete(this.key(s.businessId, s.site.key));
      await this.driver.close(s.driverId).catch(() => undefined);
      // A sign-in the founder never finished leaves nothing saved.
      if (s.held?.why === "sign_in") await this.driver.deleteContext(s.contextId).catch(() => false);
    }
  }

  private async start(businessId: string, site: BrowserSite, contextId: string, opts: { save: boolean; agentId: string | null }): Promise<BrowserSession> {
    await this.prune();
    if ([...this.sessions.values()].filter((s) => s.businessId === businessId).length >= SESSIONS_PER_PROJECT) throw new AppError("browser_busy", "This project already has its browser sessions running. Finish or stop one first.", 429);
    if (this.sessions.size >= this.limits.maxConcurrentSessions) throw new AppError("browser_busy", "Every hosted browser is in use right now. Try again in a few minutes.", 429);
    const minutes = opts.save ? this.limits.signInMinutes : this.limits.sessionMinutes;
    const opened = await this.driver.open({ businessId, site, contextId, minutes, save: opts.save });
    const at = this.now().getTime();
    const session: BrowserSession = { businessId, site, driverId: opened.id, contextId, liveViewUrl: opened.liveViewUrl, startedAt: at, steps: 0, seq: 0, nonce: "", snap: null, held: opts.save ? { why: "sign_in", note: `Sign in to ${site.name}`, since: at } : null, agentId: opts.agentId, billedAt: at, carry: 0 };
    this.sessions.set(this.key(businessId, site.key), session);
    return session;
  }

  /** The running session of a project on a site, started on its saved sign-in when there is none. Closed and refused at a limit. */
  async forAgent(businessId: string, site: BrowserSite, contextId: string, agentId: string): Promise<BrowserSession> {
    const existing = this.get(businessId, site.key);
    if (existing) {
      const ageMinutes = (this.now().getTime() - existing.startedAt) / 60_000;
      if (existing.held?.why === "sign_in") throw new AppError("founder_has_page", `The founder is signing in to ${site.name} right now. Wait for them to finish.`, 409);
      if (existing.steps >= this.limits.sessionSteps || ageMinutes >= this.limits.sessionMinutes) {
        await this.stop(businessId, site.key);
        throw new AppError("session_checkpoint", SESSION_CHECKPOINT, 409);
      }
      if (existing.held) throw new AppError("founder_has_page", `The founder has the page in ${site.name} (${existing.held.note}). Wait until they hand it back; do not start over.`, 409);
      existing.agentId = agentId;
      return existing;
    }
    return this.start(businessId, site, contextId, { save: false, agentId });
  }

  /** Reads the page and numbers its elements for this read. */
  async read(session: BrowserSession): Promise<RawSnapshot> {
    session.snap = await this.driver.snapshot(session.driverId);
    session.seq += 1;
    session.nonce = randomBytes(4).toString("hex");
    session.steps += 1;
    return session.snap;
  }

  /** The element a ref names on the newest read, with its form; null for a ref from an older read. */
  element(session: BrowserSession, ref: string): { element: PageElement; form: PageForm | undefined; index: number } | null {
    const parsed = parseRef(ref);
    if (!parsed || !session.snap || parsed.nonce !== session.nonce) return null;
    const element = session.snap.elements[parsed.index];
    return element ? { element, form: element.form !== undefined ? session.snap.forms[element.form] : undefined, index: parsed.index } : null;
  }

  hold(businessId: string, siteKey: string, why: HoldReason, note: string): boolean {
    const s = this.get(businessId, siteKey);
    if (!s || s.held?.why === "sign_in") return false;
    s.held = { why, note: note.slice(0, 300), since: this.now().getTime() };
    return true;
  }

  /** The founder gives the page back: the agent's next read sees whatever the founder left. */
  handBack(businessId: string, siteKey: string): boolean {
    const s = this.get(businessId, siteKey);
    if (!s || !s.held || s.held.why === "sign_in") return false;
    s.held = null;
    s.snap = null;
    return true;
  }

  /** Estimated cost since the last booking, in whole minor units; the remainder is carried. */
  bill(businessId: string, siteKey: string): number {
    const s = this.get(businessId, siteKey);
    if (!s) return 0;
    const at = this.now().getTime();
    const owed = s.carry + ((at - s.billedAt) / 3_600_000) * this.limits.costMinorPerHour;
    s.billedAt = at;
    s.carry = owed - Math.floor(owed);
    return Math.floor(owed);
  }

  list(businessId: string): BrowserSessionView[] {
    return [...this.sessions.values()]
      .filter((s) => s.businessId === businessId)
      .map((s) => ({ siteKey: s.site.key, siteName: s.site.name, liveViewUrl: s.liveViewUrl, url: s.snap?.url ?? null, startedAt: new Date(s.startedAt).toISOString(), steps: s.steps, held: s.held ? { why: s.held.why, note: s.held.note } : null, signIn: s.held?.why === "sign_in" }));
  }

  /** Ends a project's session on one site, or every session of the project. Answers how many ended. */
  async stop(businessId: string, siteKey?: string): Promise<number> {
    const ending = [...this.sessions.entries()].filter(([, s]) => s.businessId === businessId && (siteKey === undefined || s.site.key === siteKey));
    for (const [key] of ending) this.sessions.delete(key);
    await Promise.all(ending.map(([, s]) => this.driver.close(s.driverId).catch(() => undefined)));
    return ending.length;
  }

  /** Ends every session of every project (shutdown, tests). */
  async stopEverything(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((s) => this.driver.close(s.driverId).catch(() => undefined)));
  }

  // ---- the founder's sign-in: no agent runs during it ------------------------------------------------------------

  /** Opens a session on a new, empty saved sign-in for the founder to sign in to. Any running session on the site ends first. */
  async startSignIn(businessId: string, site: BrowserSite): Promise<BrowserSessionView> {
    await this.stop(businessId, site.key);
    const contextId = await this.driver.createContext();
    try {
      const session = await this.start(businessId, site, contextId, { save: true, agentId: null });
      await this.driver.goto(session.driverId, site.startUrl);
    } catch (e) {
      await this.stop(businessId, site.key);
      await this.driver.deleteContext(contextId).catch(() => false);
      throw e;
    }
    return this.list(businessId).find((v) => v.siteKey === site.key)!;
  }

  /**
   * The founder pressed Done: the session closes (which saves the sign-in at the provider) and the saved sign-in's id is
   * handed back to be sealed. Refused, and the saved sign-in deleted, when the page still shows a sign-in wall.
   */
  async finishSignIn(businessId: string, siteKey: string): Promise<{ contextId: string }> {
    const s = this.get(businessId, siteKey);
    if (!s || s.held?.why !== "sign_in") throw new AppError("no_sign_in", "There is no sign-in open for this site. Start again from Settings › Integrations.", 409);
    const snap = await this.driver.snapshot(s.driverId).catch(() => null);
    if (!snap || snap.needsFounder === "sign_in") throw new AppError("not_signed_in", `${s.site.name} still shows its sign-in page. Finish signing in, then press Done.`, 409);
    const saved = this.driver.exportState ? await this.driver.exportState(s.driverId) : s.contextId;
    await this.stop(businessId, siteKey);
    return { contextId: saved };
  }

  /** The founder closed the dialog without finishing: the session ends and the unsaved sign-in is deleted. */
  async cancelSignIn(businessId: string, siteKey: string): Promise<boolean> {
    const s = this.get(businessId, siteKey);
    if (!s || s.held?.why !== "sign_in") return false;
    await this.stop(businessId, siteKey);
    await this.driver.deleteContext(s.contextId).catch(() => false);
    return true;
  }
}
