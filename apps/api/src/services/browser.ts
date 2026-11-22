/**
 * The founder's side of the hosted browser (founder, Nov 22, 2026): what Working now shows of the sessions the team has
 * open in a website, and the controls over them. The gateway runs the sessions (apps/gateway browser.ts); the api checks
 * membership and the section, then asks it. A live view is the page itself: it goes to a member who may change things,
 * for this answer only, and is never written to the database, an audit row or a log.
 */
import { AppError } from "@foundmill/shared";
import type { ApiGatewayClient, GatewayBrowserSession } from "./gateway";

/** What a person reads when the hosted browser cannot be reached from here (no gateway, or none configured for it). */
export const BROWSER_NOT_AVAILABLE = "The hosted browser is not available here.";

const UNAVAILABLE_CODES = new Set(["gateway_unreachable", "config", "connector_unconfigured"]);

/** An error from the gateway that only means "the browser is not reachable here". */
const isUnavailable = (e: unknown): boolean => e instanceof AppError && UNAVAILABLE_CODES.has(e.code);

/** The project's sessions; an api with no gateway to ask answers none. `canControl` false leaves out the live view. */
export async function listBrowserSessions(gateway: ApiGatewayClient, businessId: string, canControl: boolean): Promise<GatewayBrowserSession[]> {
  if (!gateway.browserSessions) return [];
  try {
    const { sessions } = await gateway.browserSessions(businessId);
    return sessions.map((s) => (canControl ? s : { ...s, liveViewUrl: null }));
  } catch (e) {
    if (isUnavailable(e)) return [];
    throw e;
  }
}

/** Runs one control; "not available here" in plain words when there is no gateway to run it. */
export async function browserControl<T>(run: (() => Promise<T>) | null): Promise<T> {
  if (!run) throw new AppError("browser_unavailable", BROWSER_NOT_AVAILABLE, 503);
  try {
    return await run();
  } catch (e) {
    if (isUnavailable(e)) throw new AppError("browser_unavailable", BROWSER_NOT_AVAILABLE, 503);
    throw e;
  }
}
