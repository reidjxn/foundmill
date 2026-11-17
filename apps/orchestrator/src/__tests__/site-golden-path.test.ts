/**
 * WP-07 T10, the proof in one process: a project with no repository, SITES_DOMAIN set and mock integrations goes from two
 * finished site tasks to a published site a stranger opens and signs up on.
 *   1. Task A writes about.html and its session ends: release 1 (from the starter), a preview, the note in Needs you.
 *   2. Task B starts from release 1, adds pricing.html: release 2 holds both tasks' files.
 *   3. The founder presses "Publish it" on the note: `site.published` through the outbox, the site is live.
 *   4. apps/sites (as it runs, on this database) answers the site's address with the page and the footer.
 *   5. A visitor signs up through the site's form: the platform's consent page, then the api's follow path, one
 *      pending consent with `source_ref = site:<slug>` and one confirmation email asked for.
 * It lives here, not in apps/api, so the api never depends on the orchestrator (CI would then run every screen for
 * an orchestrator change). The session runner itself, the gateway and ingest's confirmation are not in this process: the session's save
 * (`saveWorkspace` with the site base) and its end (`buildSiteRelease`) are called as `session.ts` calls them, and the
 * confirmation link is ingest's (`follow-confirm.test.ts` there).
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFollowApi } from "@foundmill/sites/api-client";
import { createSitesApp } from "@foundmill/sites/app";
import { sitesDeps } from "@foundmill/sites/index";
import { contactConsents, repos } from "@foundmill/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "@foundmill/api/app";
import type { GatewayConfirmFollowRequest } from "@foundmill/api/services/gateway";
import { createApiHarness, type ApiHarness } from "@foundmill/api/__tests__/harness";
import { buildSiteRelease, siteCheckout } from "../activities/site-workspace";
import { saveWorkspace } from "../activities/workspace-store";

const DOMAIN = "sites.localhost";
let hz: ApiHarness;
const dirs: string[] = [];
const asked: GatewayConfirmFollowRequest[] = [];
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "site-proof", env: { SITES_DOMAIN: DOMAIN } });
  hz.deps.gateway.confirmFollow = async (input) => {
    asked.push(input);
    return { sent: true, simulated: true };
  };
}, 180_000);
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  await hz?.close();
});

async function siteSession(taskId: string, files: Record<string, string>) {
  const { businessId, agentId } = hz.A;
  const cwd = await mkdtemp(path.join(os.tmpdir(), "fm-site-proof-"));
  dirs.push(cwd);
  const started = await siteCheckout(hz.db, businessId, cwd, new Date());
  for (const [p, text] of Object.entries(files)) await writeFile(path.join(cwd, p), text);
  const session = await repos.agents.createSession(hz.db, businessId, { agentId, taskId, modelKey: "sonnet" });
  await saveWorkspace(hz.db as never, { businessId, taskId, sessionId: session.id, agentId, branch: `agent/${taskId}` }, cwd, { base: started.base });
  return buildSiteRelease(hz.db, { SITES_DOMAIN: DOMAIN }, { businessId, taskId, sessionId: session.id, agentId, agentName: "Riley" });
}

describe("idea to published site to a sign-up (WP-07 T10)", () => {
  it("two site tasks, Publish it, the address answers, a visitor signs up", async () => {
    const { businessId, ownerId, taskIds } = hz.A;
    expect(await repos.integrations.codeRepository(hz.db, businessId)).toBeNull();
    // A committed project, as one is once its founder took charge.
    await repos.businesses.commit(hz.db, businessId, { archetype: "b2b_saas" });

    const first = await siteSession(taskIds[0]!, { "about.html": "<!doctype html><html><body><h1>About Lunchbox</h1></body></html>" });
    expect(first).toMatchObject({ status: "release", release: { number: 1, state: "preview" } });
    const second = await siteSession(taskIds[1]!, { "pricing.html": "<!doctype html><html><body><h1>Lunch for $9</h1></body></html>" });
    expect(second.status === "release" && second.release.files.map((f) => f.path).sort()).toEqual(["about.html", "index.html", "pricing.html", "styles.css"]);

    // The note in Needs you, and its one press.
    const owner = hz.caller({ userId: ownerId });
    const note = await repos.sites.openReadyNote(hz.db, businessId);
    expect(note?.subject).toBe("Your site is ready to look at");
    await owner.inbox.decide({ businessId, itemId: note!.id, chosenOption: "site_publish" });
    const view = await owner.site.get({ businessId });
    expect(view.site).toMatchObject({ status: "live", liveReleaseNumber: 2 });
    const types = (await repos.events.outboxPending(hz.db, businessId)).map((o) => o.event.type);
    expect(types).toEqual(expect.arrayContaining(["site.release_created", "site.published", "deploy.succeeded"]));

    // apps/sites on this database, its sign-up form calling this api over its HTTP surface.
    const api = createApp(hz.deps);
    const sites = createSitesApp(
      sitesDeps({
        env: { APP_ENV: "test", APP_URL: "http://localhost:3000", SITES_DOMAIN: DOMAIN, SITES_API_URL: "http://api.test", SITES_TURNSTILE_SITE_KEY: undefined },
        run: (fn) => fn(hz.db),
        log: { info: () => {}, warn: () => {} },
        follow: createFollowApi({ apiUrl: "http://api.test", fetch: (url, init) => Promise.resolve(api.fetch(new Request(url, init))) }),
      }),
    );
    const host = `${view.site!.slug}.${DOMAIN}`;
    const visit = (p: string, init: RequestInit = {}) => sites.request(`http://${host}${p}`, { ...init, headers: { host, ...(init.headers as Record<string, string> | undefined) } });
    const home = await visit("/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(await home.text()).toContain("Report this site");
    expect(await (await visit("/pricing.html")).text()).toContain("Lunch for $9");
    expect(await (await visit("/about.html")).text()).toContain("About Lunchbox");

    const form = (body: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
    const consentPage = await (await visit("/_fm/follow", form({ email: "visitor@example.com" }))).text();
    expect(consentPage).toContain("type=\"checkbox\" name=\"consent\"");
    const done = await visit("/_fm/follow/confirm", form({ email: "visitor@example.com", consent: "yes", website: "", "cf-turnstile-response": "mock-ok" }));
    expect(await done.text()).toContain("Check your inbox");
    const consents = await hz.db.select().from(contactConsents).where(eq(contactConsents.businessId, businessId));
    expect(consents.map((c) => [c.sourceRef, c.confirmedAt])).toEqual([[`site:${view.site!.slug}`, null]]);
    expect(asked.map((a) => a.businessId)).toEqual([businessId]);
  }, 120_000);
});
