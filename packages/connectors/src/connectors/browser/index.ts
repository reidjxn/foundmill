/**
 * The hosted browser (founder, Nov 22, 2026): one connector per site on the site list (`browser_<site>`), so a saved
 * sign-in is one sealed credential per project per site, listed, health-checked and deleted like any other. The live
 * side drives a hosted session in an E2B desktop sandbox; the mock replays recorded pages (mock.ts). Both run
 * the same handlers over a `BrowserDriver`. The live driver is the gateway's (E2B, apps/gateway browser-e2b.ts), handed
 * in as `BrowserHost.sessions`.
 *
 * Connecting is the founder's own sign-in, in two calls and with no agent running: `connect(businessId, {})` opens a
 * session on a new, empty saved sign-in and answers its live view; `connect(businessId, { done: true })` closes it and
 * hands the saved sign-in's id back to be sealed (`{ cancel: true }` throws it away). An agent never sees, types or
 * stores a password, a one-time code or a recovery answer: those fields are a hard gate (classify.ts).
 */
import { AppError, browserSignInExpiry, uuid } from "@foundmill/shared";
import { ConfigError, type Connector, type HumanActionDescriptor, type IntegrationRecord, type PolicyHint, type ToolContext, type ToolResult } from "../../contract";
import { buildLiveConnector, buildMockConnector, healthResult } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { BROWSER_SITES, sitePageVerdict, type BrowserSite } from "../../browser-sites";
import { WEB_SLOTS, WebSiteRefused, webSiteFromConfig, webSiteKey, webSlotKey, webSlotOf } from "../../browser-web";
import { classifyStep, hintsForClass, instructionsToAgent, normalLabel, type StepAction, type StepVerdict } from "./classify";
import { MOCK_BROWSER_SESSIONS } from "./mock";
import { BrowserSessions, refOf, type BrowserSession, type RawSnapshot } from "./sessions";
import { BROWSER_ELEMENTS_MAX, BROWSER_RATE_LIMITS, BROWSER_TEXT_MAX, BROWSER_WRITE_TOOLS, browserConnectorKey, browserTools, type PageOutT } from "./tools";

export * from "./classify";
export * from "./sessions";
export * from "./tools";
export { createMockBrowser, mockBrowserControl, MOCK_BROWSER_SESSIONS, RECORDED_PAGES, type MockBrowserControl } from "./mock";
export { PAGE_FUNCTIONS } from "./page-script";

/** One step of a session as it is recorded for the founder: what was pressed, in words, how it was classified, and the page before it. */
export interface BrowserStepRecord {
  businessId: string;
  agentId: string | null;
  sessionId: string | null;
  siteKey: string;
  tool: string;
  /** The target in words (the element's label). */
  target: string;
  class: StepVerdict["class"];
  why: string;
  url: string;
  amount: string | null;
  /** The page before the step (PNG), when the driver could take one. */
  screenshot: Uint8Array | null;
  simulated: boolean;
}

/** What the gateway gives the browser connectors (`LiveConnectorOptions.browser`). */
export interface BrowserHost {
  /** The live sessions; built from the provider key when absent. */
  sessions?: BrowserSessions;
  /** Stores one step of the record and answers its id. The screenshot can hold other people's personal data: the host keeps it under the project's own retention and export rules. */
  recordStep?: (step: BrowserStepRecord) => Promise<string | null>;
  /**
   * A call on the saved sign-in went through: the host moves its deletion date to 30 days from now (a quiet sign-in is
   * deleted, founder, Nov 22, 2026). Best effort; never fails the call.
   */
  used?: (businessId: string, connectorKey: string) => Promise<void>;
  /**
   * A page needs the founder (a bot check, or a sign-in mid-task): the session is paused for them, and the host tells
   * them once, with a way to open the live view. Best effort; never fails the read.
   */
  needsFounder?: (input: { businessId: string; siteKey: string; siteName: string; need: "captcha" | "sign_in"; simulated: boolean }) => Promise<void>;
  /**
   * A typed website's cached terms check, read again whenever a session is about to open: a reason when the site is now
   * forbidden or a never site (the check is frozen at connect only until then), else null. `simulated`: the mock side.
   */
  siteAllowed?: (host: string, simulated: boolean) => Promise<string | null>;
  /** One of the project's own files, for `upload_file`. Absent: uploads are not available. */
  projectFile?: (businessId: string, fileId: string) => Promise<{ name: string; bytes: Uint8Array } | null>;
}

const NOT_CONNECTED = "connect it in Settings › Integrations by signing in yourself";
const ACTIONS: Readonly<Record<string, StepAction>> = { click: "click", fill: "fill", select: "select", upload_file: "upload_file" };

function pageOut(site: BrowserSite, session: BrowserSession, snap: RawSnapshot): PageOutT {
  const text = snap.text.slice(0, BROWSER_TEXT_MAX);
  return {
    site: site.name,
    url: snap.url,
    title: snap.title.slice(0, 200),
    text,
    truncated: snap.text.length > text.length || snap.elements.length > BROWSER_ELEMENTS_MAX,
    elements: snap.elements.slice(0, BROWSER_ELEMENTS_MAX).map((e, i) => ({ ref: refOf(session.nonce, i), role: e.role, label: e.label.slice(0, 120) })),
    needsFounder: snap.needsFounder,
    pageAskedMeTo: instructionsToAgent(snap.text),
  };
}

function build(site: BrowserSite, mode: "mock" | "live", sessionsOf: () => BrowserSessions, contextOf: (ctx: ToolContext) => string, host: BrowserHost) {
  const key = browserConnectorKey(site.key);
  const leftSite = (url: string): AppError | null => {
    const v = sitePageVerdict(site, url);
    if (v.ok) return null;
    // The host is said only when it is a plain DNS name: an address is page-controlled text.
    const host = /^[a-z0-9.-]{1,100}$/.test(v.host) ? v.host : "another site";
    return new AppError(v.code === "never_page" ? "never_page" : "left_site", v.code === "off_site" ? `The step ended: the page tried to go to ${host}, outside ${site.name}. Nothing was done there.` : v.message, 403, { host });
  };
  /** A sign-in page on the site's own sign-in host: shown as "the founder is needed", never worked in. */
  const signInPage = (url: string): boolean => {
    try {
      const u = new URL(url);
      return u.protocol === "https:" && [...site.hosts, ...(site.signInHosts ?? [])].includes(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  };
  /** An address as it is shown to an agent or a founder: origin and path, no query or fragment. */
  const shownUrl = (url: string): string => {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`.slice(0, 200);
    } catch {
      return site.startUrl;
    }
  };
  /** A label as it is shown to a founder: its first few plain words, so a page cannot write its own sentence into the founder's task. */
  const shownLabel = (label: string): string =>
    normalLabel(label)
      .split(/["“”.!?;:()[\]<>]/)[0]!
      .replace(/[^\p{L}\p{N} ,&'+/#-]/gu, "")
      .trim()
      .split(" ")
      .slice(0, 6)
      .join(" ")
      .slice(0, 60) || "this control";
  const configured = (): BrowserSessions | null => {
    try {
      return sessionsOf();
    } catch {
      return null;
    }
  };
  const sessionFor = (ctx: ToolContext) => sessionsOf().forAgent(ctx.businessId, site, contextOf(ctx), ctx.agentId);

  /** Reads the page for the agent. A sign-in wall on a session's first page means the saved sign-in is signed out: said once, never retried. */
  const read = async (session: BrowserSession): Promise<PageOutT> => {
    const first = session.seq === 0;
    const snap = await sessionsOf().read(session);
    const off = leftSite(snap.url);
    if (off && !(snap.needsFounder === "sign_in" && signInPage(snap.url))) {
      session.snap = null;
      await sessionsOf().driver.goto(session.driverId, site.startUrl).catch(() => undefined);
      throw off;
    }
    if (first && snap.needsFounder === "sign_in") {
      await sessionsOf().stop(session.businessId, site.key);
      throw new AppError("sign_in_again", `Sign in again: ${site.name} signed the saved session out. The founder signs in again in Settings › Integrations; do not retry.`, 401);
    }
    // A bot check, or a sign-in the site asks for mid-task, is the founder's (founder, Nov 24, 2026: "user solves
    // captchas, no auto-solving"): the session pauses for them and they get one note. The agent sees the page as it is,
    // and its next step waits until the founder hands the page back.
    if (snap.needsFounder) {
      if (sessionsOf().hold(session.businessId, site.key, "request", snap.needsFounder === "captcha" ? `Solve the check on ${site.name}` : `Sign in to ${site.name}`)) {
        await host.needsFounder?.({ businessId: session.businessId, siteKey: site.key, siteName: site.name, need: snap.needsFounder, simulated: mode === "mock" }).catch(() => undefined);
      }
    }
    return pageOut(site, session, snap);
  };

  /** The step a write call names, classified from the page as it was last read; null when the ref is stale or there is no session. */
  const stepOf = (businessId: string, tool: string, args: unknown): { session: BrowserSession; index: number; label: string; verdict: StepVerdict } | null => {
    const action = ACTIONS[tool];
    const ref = (args as { ref?: unknown } | null)?.ref;
    // An unconfigured gateway has no sessions: there is no step to read, and the tool's own hints stand.
    const session = configured()?.get(businessId, site.key);
    if (!action || typeof ref !== "string" || !session?.snap) return null;
    const found = sessionsOf().element(session, ref);
    if (!found) return null;
    return { session, index: found.index, label: found.element.label, verdict: classifyStep({ action, element: found.element, form: found.form, pageUrl: session.snap.url, site }) };
  };

  const record = async (ctx: Pick<ToolContext, "businessId" | "agentId" | "sessionId">, session: BrowserSession, tool: string, label: string, verdict: StepVerdict): Promise<string | null> => {
    if (!host.recordStep) return null;
    const screenshot = await sessionsOf().driver.screenshot(session.driverId).catch(() => null);
    return host.recordStep({ businessId: ctx.businessId, agentId: ctx.agentId || null, sessionId: ctx.sessionId, siteKey: site.key, tool, target: shownLabel(label), class: verdict.class, why: verdict.why, url: session.snap?.url ?? "", amount: verdict.amount ?? null, screenshot, simulated: mode === "mock" }).catch(() => null);
  };

  const write = async (tool: "click" | "fill" | "select" | "upload_file", args: { ref: string; value?: string; option?: string; fileId?: string }, ctx: ToolContext) => {
    const session = await sessionFor(ctx);
    const step = stepOf(ctx.businessId, tool, args);
    if (!step) throw new AppError("stale_ref", "That ref is not from the newest read of the page. Call read_page and use a ref from it.", 409);
    if (session.snap?.needsFounder) throw new AppError("needs_founder", `The page is a ${session.snap.needsFounder === "captcha" ? "bot check" : "sign-in"}. Only the founder gets past it: call request_founder.`, 403);
    // The gateway holds a hard gate before this handler; refused here too, so no path presses one.
    if (step.verdict.class === "hard_gate") throw new AppError("hard_gate", "Not pressed: this step is the founder's own.", 403);
    const element = session.snap!.elements[step.index]!;
    if (tool === "click" && element.href) {
      const off = leftSite(element.href);
      if (off) throw off;
    }
    let file: { name: string; bytes: Uint8Array } | undefined;
    if (tool === "upload_file") {
      const found = host.projectFile ? await host.projectFile(ctx.businessId, args.fileId ?? "") : null;
      if (!found) throw new AppError("file_unavailable", host.projectFile ? "That file is not one of this project's files." : "Attaching a file is not available yet: ask the founder to attach it (request_founder).", 404);
      file = found;
    }
    const before = session.snap!.url;
    await record(ctx, session, tool, step.label, step.verdict);
    const value = tool === "fill" ? args.value : tool === "select" ? args.option : undefined;
    const url = await sessionsOf().driver.act(session.driverId, { action: tool, index: step.index, expect: { role: element.role, label: element.label }, ...(value !== undefined ? { value } : {}), ...(file ? { file } : {}) });
    session.steps += 1;
    // What the agent read is no longer the page: the next step needs a new read.
    session.snap = null;
    const off = leftSite(url);
    if (off) {
      await sessionsOf().driver.goto(session.driverId, before).catch(() => undefined);
      throw off;
    }
    return { done: true, url: shownUrl(url), class: step.verdict.class as "read" | "reversible" | "outward" | "unknown", note: "Done. Read the page again to check the change before the next step." };
  };

  const handlers = {
    open_page: async ({ url }: { url: string }, ctx: ToolContext) => {
      let target: string;
      try {
        target = new URL(url, site.startUrl).toString();
      } catch {
        throw new AppError("invalid_args", "That is not a web address.", 400);
      }
      // Checked before any session starts, so a refused address costs nothing and opens nothing.
      const off = leftSite(target);
      if (off) throw off;
      const session = await sessionFor(ctx);
      const landed = await sessionsOf().driver.goto(session.driverId, target);
      session.snap = null;
      const redirected = leftSite(landed);
      if (redirected && !signInPage(landed)) {
        await sessionsOf().driver.goto(session.driverId, site.startUrl).catch(() => undefined);
        throw redirected;
      }
      return read(session);
    },
    read_page: async (_a: object, ctx: ToolContext) => read(await sessionFor(ctx)),
    find: async ({ words }: { words: string }, ctx: ToolContext) => {
      const session = await sessionFor(ctx);
      if (!session.snap) await sessionsOf().read(session);
      const wanted = words.toLowerCase().split(/\W+/).filter((w) => w.length > 1);
      const scored = session.snap!.elements
        .map((e, i) => ({ e, i, score: wanted.filter((w) => `${e.label} ${e.role} ${e.name}`.toLowerCase().includes(w)).length }))
        .filter((m) => m.score > 0)
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .slice(0, 10);
      return { url: session.snap!.url, matches: scored.map((m) => ({ ref: refOf(session.nonce, m.i), role: m.e.role, label: m.e.label.slice(0, 120) })) };
    },
    fill: (a: { ref: string; value: string }, ctx: ToolContext) => write("fill", a, ctx),
    select: (a: { ref: string; option: string }, ctx: ToolContext) => write("select", a, ctx),
    upload_file: (a: { ref: string; fileId: string }, ctx: ToolContext) => write("upload_file", a, ctx),
    click: (a: { ref: string }, ctx: ToolContext) => write("click", a, ctx),
  };

  /** A step that is a hard gate never runs: the session is held for the founder and the call answers with what they will press. */
  const gate = async (name: string, args: unknown, ctx: ToolContext): Promise<ToolResult<HumanActionDescriptor> | null> => {
    const step = BROWSER_WRITE_TOOLS.has(name) ? stepOf(ctx.businessId, name, args) : null;
    if (!step || step.verdict.class !== "hard_gate") return null;
    const shown = shownLabel(step.label);
    const stepId = await record(ctx, step.session, name, step.label, step.verdict);
    sessionsOf().hold(ctx.businessId, site.key, "hard_gate", `Press "${shown}" yourself`);
    const url = shownUrl(step.session.snap?.url ?? site.startUrl);
    return {
      ok: false,
      error: { code: "hard_gate", message: `${key}.${name}: this step pays, agrees, signs, deletes, changes a security setting or takes a secret. The team never presses it; it waits for the founder's own press.` },
      data: {
        connector: key,
        tool: name,
        title: `Press "${shown}" in ${site.name} yourself`.slice(0, 200),
        instructions: `The team stopped before "${shown}" on ${url}, because pressing it may pay, agree, sign, delete, change a security setting or enter a secret.${step.verdict.amount ? ` Amount shown: ${step.verdict.amount}.` : ""} Nothing was pressed. Open ${site.name} from Working now, check the page, and press it yourself if you want it done. Then press Hand back.`,
        args: { siteKey: site.key, address: url, label: shown, ...(step.verdict.amount ? { amount: step.verdict.amount } : {}), ...(stepId ? { stepId } : {}) },
        reason: "hard_gate",
      },
      costMinor: 0,
    };
  };

  const wrap = (connector: Connector): Connector => ({
    ...connector,
    async callTool(name, args, ctx) {
      const gated = await gate(name, args, ctx);
      if (gated) return gated;
      if (name === "request_founder") {
        const a = (args ?? {}) as { need?: unknown; sentence?: unknown };
        configured()?.hold(ctx.businessId, site.key, "request", typeof a.sentence === "string" ? a.sentence : "The team needs you on this page");
      }
      const result = await connector.callTool(name, args, ctx);
      if (result.ok && mode === "live") await host.used?.(ctx.businessId, key).catch(() => undefined);
      // Browser time since the last call, booked with this one (Estimate).
      return result.ok ? { ...result, costMinor: result.costMinor + (configured()?.bill(ctx.businessId, site.key) ?? 0) } : result;
    },
    async stepHints(name, args, businessId): Promise<PolicyHint | null> {
      if (!BROWSER_WRITE_TOOLS.has(name)) return null;
      const step = stepOf(businessId, name, args);
      // No session, or a ref from an older read: the tool's own hints stand, so the call asks first.
      return step ? hintsForClass(step.verdict.class) : null;
    },
  });

  return { key, handlers, wrap };
}

export function createBrowserConnector(site: BrowserSite, options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const host = options.browser ?? {};
  const key = browserConnectorKey(site.key);
  const displayName = `${site.name} (website)`;
  const tools = browserTools(site.name);
  const base = { key, displayName, phase: 3 as const, auth: { kind: "oauth" as const }, tools, rateLimits: BROWSER_RATE_LIMITS };

  const mockSide = build(site, "mock", () => MOCK_BROWSER_SESSIONS, () => "mock", host);
  const mock = buildMockConnector({
    ...base,
    now: () => MOCK_NOW,
    handlers: mockSide.handlers,
    connect: async (businessId) => mockIntegrationRecord(key, businessId, { accountLabel: `Signed in to ${site.name} (mock)` }),
    healthcheck: async () => mockHealth(key),
  });
  const wrappedMock = mockSide.wrap(mock);
  (wrappedMock as { mock: Connector }).mock = wrappedMock;
  Object.assign(wrappedMock, { isMock: true, simulations: mock.simulations, simulate: mock.simulate });

  const sessions = (): BrowserSessions => {
    if (!host.sessions) throw new ConfigError(key, "the hosted browser", "E2B_API_KEY on the gateway, which runs the browser sessions");
    return host.sessions;
  };
  const liveSide = build(
    site,
    "live",
    sessions,
    (ctx) => {
      if (!ctx.credential?.secret) throw new ConfigError(key, "a saved sign-in", NOT_CONNECTED);
      return ctx.credential.secret;
    },
    host,
  );
  const live = buildLiveConnector(
    {
      ...base,
      now,
      handlers: liveSide.handlers,
      connect: async (businessId, input): Promise<IntegrationRecord> => {
        const step = (input ?? {}) as { done?: unknown; cancel?: unknown };
        const createdAt = now().toISOString();
        const record = (status: IntegrationRecord["status"], config: Record<string, unknown>): IntegrationRecord => ({ id: uuid(), businessId, connectorKey: key, status, scopes: [], accountLabel: `Signed in to ${site.name}`, externalAccountId: null, config, credentialRef: null, expiresAt: null, lastHealthAt: createdAt, createdAt });
        if (step.cancel === true) {
          await sessions().cancelSignIn(businessId, site.key);
          return record("disconnected", { step: "canceled" });
        }
        if (step.done === true) {
          const { contextId } = await sessions().finishSignIn(businessId, site.key);
          // A quiet sign-in is deleted after 30 days; every use moves the date (`BrowserHost.used`).
          return { ...record("connected", { siteKey: site.key, connectedAt: createdAt }), credentialToStore: { kind: "oauth", secret: contextId, expiresAt: browserSignInExpiry(now()).toISOString() } };
        }
        const view = await sessions().startSignIn(businessId, site);
        // The live view is the page itself: handed to the founder's dialog for this sign-in, never stored.
        return record("disconnected", { step: "sign_in", liveViewUrl: view.liveViewUrl });
      },
      healthcheck: async (integration, credential) => {
        const startedAt = now().getTime();
        if (!credential?.secret) return healthResult("disconnected", startedAt, { now, message: `Sign in to ${site.name} again` });
        const exists = await sessions().driver.contextExists(credential.secret).catch(() => null);
        if (exists === null) return healthResult("degraded", startedAt, { now, message: "The hosted browser could not be reached" });
        return exists ? healthResult(integration.status === "expired" ? "expired" : "connected", startedAt, { now }) : healthResult("expired", startedAt, { now, message: "Sign in again" });
      },
      // Disconnecting ends any running session; the saved sign-in is sealed in the vault, where the api revokes it.
      disconnect: async (integration, credential) => {
        await sessions().stop(integration.businessId, site.key);
        return credential?.secret ? sessions().driver.deleteContext(credential.secret) : false;
      },
    },
    mock,
  );
  return { ...liveSide.wrap(live), mock: wrappedMock };
}

/** A typed website's connector (`browser_web_<n>`): the site is read from the integration's config on every call, never from code. */
export function createWebSlotConnector(slot: number, options: LiveConnectorOptions = {}): Connector {
  const host = options.browser ?? {};
  const siteKey = webSiteKey(slot);
  const placeholder: BrowserSite = { key: siteKey, name: "the website", state: "ask_first", hosts: ["placeholder.invalid"], startUrl: "https://placeholder.invalid/", terms: { url: "https://placeholder.invalid/", line: "", checkedOn: "" } };
  const template = createBrowserConnector(placeholder, options);
  // One connector per site seen, so a slot reconnected to another site never reuses the old one's rules.
  const cache = new Map<string, Connector>();
  const forSite = (site: BrowserSite): Connector => {
    const id = JSON.stringify(site);
    let c = cache.get(id);
    if (!c) {
      if (cache.size >= 20) cache.clear();
      c = createBrowserConnector(site, options);
      cache.set(id, c);
    }
    return c;
  };
  const siteOf = (config: unknown): BrowserSite => {
    // Nothing set up in this place: not connected, said as every unconnected connector says it.
    if (typeof (config as { address?: unknown } | null)?.address !== "string") throw new ConfigError(webSlotKey(slot), "a website", "connect a website in Settings › Integrations by signing in yourself");
    try {
      return webSiteFromConfig(slot, config);
    } catch (e) {
      if (e instanceof WebSiteRefused) throw new AppError("site_unavailable", e.message, 409);
      throw e;
    }
  };
  const side = (base: Connector, pick: (c: Connector) => Connector, sessionsOf: () => BrowserSessions | null, simulated: boolean): Connector => ({
    ...base,
    displayName: "A website you added",
    // A hard gate never runs, whatever the place holds: the placeholder's own gate answers it.
    callTool: async (name, args, ctx) => {
      if (base.policyHints[name]?.hardGate) return base.callTool(name, args, ctx);
      const site = siteOf(ctx.integration.config);
      // A session about to open re-reads the site's cached check: what was allowed at connect may not be now.
      if (!sessionsOf()?.get(ctx.businessId, siteKey)) {
        const why = await host.siteAllowed?.(site.hosts[0]!, simulated);
        if (why) throw new AppError("site_no_longer_allowed", why, 403);
      }
      return pick(forSite(site)).callTool(name, args, ctx);
    },
    // The site of a running session is the one it was opened on, so a write is classified by that site's own rules.
    stepHints: async (name, args, businessId) => {
      const running = sessionsOf()?.get(businessId, siteKey)?.site;
      return running ? ((await pick(forSite(running)).stepHints?.(name, args, businessId)) ?? null) : null;
    },
    connect: async (businessId, input) => {
      const site = siteOf(input);
      const record = await pick(forSite(site)).connect(businessId, input);
      const { address, check } = input as { address: string; check: unknown };
      return { ...record, config: { ...record.config, siteKey, address, check } };
    },
    healthcheck: (integration, credential) => pick(forSite(siteOf(integration.config))).healthcheck(integration, credential),
    disconnect: async (integration, credential) => {
      try {
        return (await pick(forSite(siteOf(integration.config))).disconnect?.(integration, credential)) ?? false;
      } catch (e) {
        await sessionsOf()?.stop(integration.businessId, siteKey);
        if (e instanceof AppError) return false;
        throw e;
      }
    },
  });
  const mock = side(template.mock, (c) => c.mock, () => MOCK_BROWSER_SESSIONS, true);
  (mock as { mock: Connector }).mock = mock;
  Object.assign(mock, { isMock: true, simulations: (template.mock as { simulations?: unknown }).simulations, simulate: (template.mock as { simulate?: unknown }).simulate });
  return { ...side(template, (c) => c, () => host.sessions ?? null, false), mock };
}

export const BROWSER_CONNECTOR_FACTORIES: Readonly<Record<string, (o?: LiveConnectorOptions) => Connector>> = Object.freeze({
  ...Object.fromEntries(BROWSER_SITES.map((s) => [browserConnectorKey(s.key), (o?: LiveConnectorOptions) => createBrowserConnector(s, o)])),
  ...Object.fromEntries(Array.from({ length: WEB_SLOTS }, (_, i) => [webSlotKey(i + 1), (o?: LiveConnectorOptions) => createWebSlotConnector(i + 1, o)])),
});

/** The static site a browser connector key stands for, or null (a typed website's slot is not one: its site is in the integration's config). */
export const browserSiteOfConnector = (connectorKey: string): BrowserSite | null => BROWSER_SITES.find((s) => browserConnectorKey(s.key) === connectorKey) ?? null;

/** True for any hosted-browser connector: a site on the list or a typed website's slot. */
export const isBrowserConnector = (connectorKey: string): boolean => browserSiteOfConnector(connectorKey) !== null || webSlotOf(connectorKey) !== null;

/** The site a browser connector stands for given its integration's config: the list's entry, or the typed website's; null when there is none. */
export function browserSiteOfIntegration(connectorKey: string, config: unknown): BrowserSite | null {
  const slot = webSlotOf(connectorKey);
  if (slot === null) return browserSiteOfConnector(connectorKey);
  try {
    return webSiteFromConfig(slot, config);
  } catch {
    return null;
  }
}

/**
 * A session's grants with the hosted browser's tools for the sites the project connected (Part D, D3): an agent that
 * holds the `browser_work` skill works in a site only when the founder signed in to it, and only through that site's
 * own connector. Applied before a second read narrows the grants, so a revision never gains them.
 */
export function withBrowserSites<G extends { toolRefs: string[]; servers: string[]; mcpTools: string[] }>(grants: G, connectedConnectorKeys: readonly string[]): G {
  const keys = connectedConnectorKeys.filter(isBrowserConnector);
  if (keys.length === 0) return grants;
  return { ...grants, toolRefs: [...new Set([...grants.toolRefs, ...keys.map((k) => `${k}:*`)])], servers: [...new Set([...grants.servers, ...keys])], mcpTools: [...new Set([...grants.mcpTools, ...keys.map((k) => `mcp__${k}`)])] };
}

/** The skill that brings the browser's tools. */
export const BROWSER_WORK_SKILL = "browser_work";
