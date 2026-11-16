/**
 * The two api calls of a site's sign-up form (WP-07 T6), over the api's tRPC HTTP surface (superjson wire format, one
 * call per request). Server to server: the visitor's browser never talks to the api. A refusal comes back as the api's
 * own sentence (`FOLLOW_ERRORS`); anything else unexpected is the "did not go through" sentence, never a detail.
 */
import { FOLLOW_ERRORS } from "@foundmill/shared/project-page";
import type { FollowSubmitAnswer, SitesFollowApi } from "./app";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const REFUSALS: Record<string, string> = {
  follow_email: FOLLOW_ERRORS.email,
  follow_consent: FOLLOW_ERRORS.consent,
  follow_closed: FOLLOW_ERRORS.closed,
  follow_unverified: FOLLOW_ERRORS.unverified,
  follow_unavailable: FOLLOW_ERRORS.unavailable,
};

export function createFollowApi(options: { apiUrl: string; fetch?: Fetch; timeoutMs?: number }): SitesFollowApi {
  const base = options.apiUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const call = async (path: string, init: RequestInit): Promise<{ data?: unknown; error?: { message?: string; data?: { code?: string; appCode?: string } } }> => {
    const res = await doFetch(`${base}/trpc/${path}`, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? 8_000), headers: { "content-type": "application/json", "x-foundmill-client": "sites" } });
    const body = (await res.json().catch(() => null)) as { result?: { data?: { json?: unknown } }; error?: { json?: { message?: string; data?: { code?: string; appCode?: string } } } } | null;
    if (body?.error) return { error: body.error.json };
    return { data: body?.result?.data?.json };
  };
  return {
    async consent(slug) {
      try {
        const out = await call(`publicPage.siteConsent?input=${encodeURIComponent(JSON.stringify({ json: { slug } }))}`, { method: "GET" });
        const data = out.data as { consentText?: unknown } | null | undefined;
        return data && typeof data.consentText === "string" ? { consentText: data.consentText } : null;
      } catch {
        return null;
      }
    },
    async submit(input): Promise<FollowSubmitAnswer> {
      try {
        const out = await call("publicPage.follow", { method: "POST", body: JSON.stringify({ json: { ...input, via: "site" } }) });
        if (!out.error) return { ok: true };
        const app = out.error.data?.appCode;
        if (app && REFUSALS[app]) return { refused: REFUSALS[app] };
        return { refused: out.error.data?.code === "TOO_MANY_REQUESTS" ? FOLLOW_ERRORS.busy : FOLLOW_ERRORS.failed };
      } catch {
        return { refused: FOLLOW_ERRORS.failed };
      }
    },
  };
}
