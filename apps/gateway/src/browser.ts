/**
 * The hosted browser on the gateway (founder, Nov 22, 2026): the only place a browser is driven. Agents reach it through
 * the `browser_<site>` connectors and the tool pipeline; these routes are for the founder's screens, asked by the api
 * alone after its own membership check:
 *
 *   POST /v1/browser/sessions  the project's running sessions (the site, the live view, who has the page)
 *   POST /v1/browser/takeover  the founder takes the page: the agent's steps wait
 *   POST /v1/browser/handback  the founder gives it back
 *   POST /v1/browser/stop      ends one session, or every session of the project (Stop all agents)
 *
 * The live view's address is the page itself. It is answered only here, to the api, for a member of the project, and is
 * never stored or logged.
 */
import { z } from "zod";
import { BROWSER_SITES, MOCK_BROWSER_SESSIONS, browserConnectorKey, neverCategoryMessage, neverMessage, siteNameOf, WEB_SLOT_KEYS, type BrowserHost, type BrowserSessions, type BrowserSessionView } from "@foundmill/connectors";
import { repos, type Db } from "@foundmill/db";
import { BROWSER_CHECK_NOTE, browserCheckSubject, browserSignInExpiry } from "@foundmill/shared";
import { writeGatewayEvent } from "./events";
import { GatewayError, modeFor, safeError, type GatewayDeps, type GatewayLogger } from "./pipeline";
import { isLiveViewUrl } from "./browser-e2b";

export const BrowserProjectRequest = z.object({ businessId: z.uuid() });
export const BrowserSiteRequest = BrowserProjectRequest.extend({ siteKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/) });
export const BrowserStopRequest = BrowserProjectRequest.extend({ siteKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).optional() });

/** Every set of sessions this gateway holds: the recorded mock's, and the live provider's when its key is set. */
const allSessions = (deps: Pick<GatewayDeps, "browserSessions">): BrowserSessions[] => [MOCK_BROWSER_SESSIONS, ...(deps.browserSessions ? [deps.browserSessions] : [])];

function sessionsOfSite(deps: GatewayDeps, siteKey: string): BrowserSessions {
  if (!BROWSER_SITES.some((s) => s.key === siteKey) && !WEB_SLOT_KEYS.includes(browserConnectorKey(siteKey))) throw new GatewayError("unknown_site", "That website is not on the site list or added", 404, { siteKey });
  if (modeFor(deps, browserConnectorKey(siteKey)) === "mock") return MOCK_BROWSER_SESSIONS;
  if (!deps.browserSessions) throw new GatewayError("connector_unconfigured", "The hosted browser is not configured on this gateway", 503);
  return deps.browserSessions;
}

export function listBrowserSessions(deps: GatewayDeps, businessId: string): { sessions: (BrowserSessionView & { simulated: boolean })[] } {
  // Only an address on E2B's own sandbox hosts is ever handed on, and only its origin and path are said of the page.
  return { sessions: allSessions(deps).flatMap((s) => s.list(businessId).map((v) => ({ ...v, liveViewUrl: isLiveViewUrl(v.liveViewUrl) ? v.liveViewUrl : null, url: v.url ? shownUrl(v.url) : null, simulated: s === MOCK_BROWSER_SESSIONS }))) };
}

async function audit(deps: GatewayDeps, businessId: string, action: string, details: Record<string, unknown>): Promise<void> {
  await repos.audit.append(deps.db, businessId, { actorKind: "system", action, target: { connector: "browser" }, details }).catch((e: unknown) => deps.log.warn({ err: safeError(e), businessId }, "browser audit not written"));
}

const shownUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.slice(0, 200);
  } catch {
    return null;
  }
};

export async function takeOverBrowser(deps: GatewayDeps, input: z.output<typeof BrowserSiteRequest>, service: string): Promise<{ held: boolean }> {
  const held = sessionsOfSite(deps, input.siteKey).hold(input.businessId, input.siteKey, "founder", "The founder took over");
  await audit(deps, input.businessId, "gateway.browser.takeover", { service, siteKey: input.siteKey, held });
  return { held };
}

export async function handBackBrowser(deps: GatewayDeps, input: z.output<typeof BrowserSiteRequest>, service: string): Promise<{ handedBack: boolean }> {
  const handedBack = sessionsOfSite(deps, input.siteKey).handBack(input.businessId, input.siteKey);
  await audit(deps, input.businessId, "gateway.browser.handback", { service, siteKey: input.siteKey, handedBack });
  return { handedBack };
}

/** Ends a project's browser sessions: one site's, or all of them at once (Stop all agents). */
export async function stopBrowserSessions(deps: Pick<GatewayDeps, "browserSessions" | "db" | "log">, input: z.output<typeof BrowserStopRequest>, service: string): Promise<{ stopped: number }> {
  const counts = await Promise.all(allSessions(deps).map((s) => s.stop(input.businessId, input.siteKey)));
  const stopped = counts.reduce((a, b) => a + b, 0);
  if (stopped > 0) await repos.audit.append(deps.db, input.businessId, { actorKind: "system", action: "gateway.browser.stopped", target: { connector: "browser" }, details: { service, stopped, ...(input.siteKey ? { siteKey: input.siteKey } : {}) } }).catch((e: unknown) => deps.log.warn({ err: safeError(e) }, "browser audit not written"));
  return { stopped };
}

/**
 * What the browser connectors get from this gateway: the step record. Each write and each held step is one row of
 * `browser_steps` with the page before it; a screenshot can hold other people's personal data, so the row follows the
 * project's own retention and export rules (packages/db `browser_steps`).
 */
export function browserHost(db: Db, log: GatewayLogger, sessions: BrowserSessions | null, now: () => Date = () => new Date()): BrowserHost {
  // One expiry write per sign-in per hour is enough to keep a used sign-in from being deleted as quiet.
  const touched = new Map<string, number>();
  return {
    ...(sessions ? { sessions } : {}),
    // A typed website's check is read again when a session is about to open: forbidden or never now means no session.
    siteAllowed: async (host, simulated) => {
      const never = neverMessage(host);
      if (never) return never;
      const row = await repos.siteTermsChecks.get(db, host, { simulated, now: now() });
      if (row?.neverCategory) return neverCategoryMessage(host, row.neverCategory);
      return row?.verdict === "forbids" ? `${siteNameOf(host)}'s terms no longer allow automated use of an account. Disconnect it in Settings › Integrations.` : null;
    },
    used: async (businessId, connectorKey) => {
      const key = `${businessId}:${connectorKey}`;
      const at = now();
      if ((touched.get(key) ?? 0) > at.getTime() - 3_600_000) return;
      touched.set(key, at.getTime());
      const row = await repos.integrations.getByKey(db, businessId, connectorKey);
      const credential = row ? await repos.credentials.latest(db, businessId, row.id) : null;
      if (credential) await repos.credentials.setExpiry(db, businessId, credential.meta.id, browserSignInExpiry(at));
    },
    // A bot check or a sign-in mid-task: one decision note from the Chief of Staff (emailed and pushed as a waiting
    // decision), answered once the founder has solved it in the live view. A note still waiting is not written again.
    needsFounder: async ({ businessId, siteKey, siteName, need, simulated }) => {
      try {
        const subject = browserCheckSubject(siteName, need);
        if ((await repos.inbox.openBySubject(db, businessId, subject)).some((i) => i.state !== "answered")) return;
        const chief = await repos.agents.chiefOfStaff(db, businessId);
        if (!chief) return;
        await db.transaction(async (tx) => {
          const item = await repos.inbox.createItem(tx, businessId, {
            type: "decision",
            from_agent_id: chief.id,
            subject,
            body_md: `${simulated ? "Simulated: " : ""}The team is working in ${siteName} and the page asks for ${need === "captcha" ? "a check that only a person can do (a CAPTCHA)" : "your sign-in"}. The team never does that itself. Open ${siteName} from Development › Live sessions, press Take over, ${need === "captcha" ? "solve the check" : "sign in"}, then press Hand back. The team carries on from there.`,
            status_strip: [],
            exhibit: { kind: "none", spec_ref: null },
            decision: { options: [
                { id: BROWSER_CHECK_NOTE.options.done, label: "I've done it, carry on", recommended: true, consequence: "The team gets the page back and carries on.", cost_minor: 0, reversible: true },
                { id: BROWSER_CHECK_NOTE.options.stop, label: "Stop for now", recommended: false, consequence: `The session in ${siteName} ends. The team picks the task up again next time.`, cost_minor: 0, reversible: true },
              ], free_text: false, expires_at: null, key: `${BROWSER_CHECK_NOTE.keyPrefix}${siteKey}` },
            blocks_continue: false,
            source_event_ids: [],
            entity_ids: [],
          });
          await writeGatewayEvent(tx, { businessId, type: "inbox.item_created", actor: { kind: "agent", id: chief.id }, payload: { inboxItemId: item.id, type: item.type, fromAgentId: chief.id, subject: item.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
        });
      } catch (e) {
        log.warn({ err: safeError(e), businessId, siteKey }, "browser check note not written");
      }
    },
    recordStep: async (step) => {
      try {
        const { businessId, agentId, sessionId, siteKey, tool, target, why, url, amount, screenshot, simulated } = step;
        // The address is kept without its query or fragment: those can carry reset tokens, codes and personal data.
        return (await repos.browserSteps.record(db, businessId, { agentId, sessionId, siteKey, tool, target, class: step.class, why, url: shownUrl(url) ?? "", amount, screenshot: screenshot ? new Uint8Array(screenshot) : null, simulated })).id;
      } catch (e) {
        // The step itself is not stopped by a record that could not be written; a held step still reaches the founder.
        log.warn({ err: safeError(e), businessId: step.businessId, siteKey: step.siteKey }, "browser step not recorded");
        return null;
      }
    },
  };
}
