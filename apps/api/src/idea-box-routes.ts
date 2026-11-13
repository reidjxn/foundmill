/**
 * The idea box's two plain routes (docs/IDEA_BOX.md), outside tRPC because they set and read a cookie and answer a
 * line-by-line stream:
 *
 *   POST /idea-box/draft  the visitor's line (or interest) and the Turnstile token → NDJSON events (services/idea-box.ts)
 *   GET  /idea-box/mine   the browser's live card, or 204
 *
 * The browser calls them on the api's own address (cross-origin, with credentials), so the api sees the visitor's
 * address. Only the web app's origins may call them (the CORS list, checked here for the POST too). The cookie `fm_idea`
 * is httpOnly and SameSite=Lax; in production its Domain is the site's (`IDEA_COOKIE_DOMAIN`), so the web app's /start
 * reads it after sign-in.
 */
import { IDEA_COOKIE, IDEA_COOKIE_MAX_AGE_S, type IdeaBoxEvent } from "@foundmill/shared";
import type { Env, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { clientAddressOf, type ApiDeps } from "./context";
import { mineIdeaBox, planIdeaBoxDraft } from "./services/idea-box";

/** The draft request is a line of text and a token: 8 KB is plenty. */
export const IDEA_BOX_MAX_BODY_BYTES = 8 * 1024;

const NDJSON_HEADERS = { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } as const;

/** The `Set-Cookie` value for a new browser token. */
export function ideaCookie(token: string, env: Pick<ApiDeps["env"], "APP_ENV" | "IDEA_COOKIE_DOMAIN">): string {
  const parts = [`${IDEA_COOKIE}=${token}`, "Path=/", `Max-Age=${IDEA_COOKIE_MAX_AGE_S}`, "HttpOnly", "SameSite=Lax"];
  if (env.APP_ENV !== "development" && env.APP_ENV !== "test") parts.push("Secure");
  if (env.IDEA_COOKIE_DOMAIN) parts.push(`Domain=${env.IDEA_COOKIE_DOMAIN}`);
  return parts.join("; ");
}

function ndjson(events: AsyncGenerator<IdeaBoxEvent, void, undefined>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
}

export function registerIdeaBoxRoutes<E extends Env>(app: Hono<E>, deps: ApiDeps, origins: readonly string[]): void {
  const fromSite = (origin: string | undefined) => !!origin && origins.includes(origin);

  app.post(
    "/idea-box/draft",
    bodyLimit({ maxSize: IDEA_BOX_MAX_BODY_BYTES, onError: (c) => c.json({ type: "error", code: "invalid" }, 413) }),
    async (c) => {
      const origin = c.req.header("origin");
      if (!fromSite(origin)) return c.json({ error: "forbidden" }, 403);
      const body = await c.req.json().catch(() => null);
      const plan = await planIdeaBoxDraft(
        { db: deps.db, models: deps.models, limits: deps.limits, env: deps.env, gateway: deps.gateway, log: deps.log },
        { body, cookieToken: getCookie(c, IDEA_COOKIE) ?? null, address: clientAddressOf(c.req.raw.headers, c), hostname: deps.env.APP_ENV === "production" || deps.env.APP_ENV === "staging" ? hostnameOf(origin) : null },
        c.req.raw.signal,
      );
      const headers = new Headers(NDJSON_HEADERS);
      if (plan.setToken) headers.append("set-cookie", ideaCookie(plan.setToken, deps.env));
      return new Response(ndjson(plan.events), { status: 200, headers });
    },
  );

  app.get("/idea-box/mine", async (c) => {
    if (!fromSite(c.req.header("origin"))) return c.json({ error: "forbidden" }, 403);
    const event = await mineIdeaBox({ db: deps.db }, getCookie(c, IDEA_COOKIE) ?? null);
    if (!event) return c.body(null, 204, { "cache-control": "no-store" });
    return c.json(event, 200, { "cache-control": "no-store" });
  });
}

/** The site's hostname without "www." (Turnstile reports the hostname the widget ran on). */
function hostnameOf(origin: string | undefined): string | null {
  try {
    return origin ? new URL(origin).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}
