/**
 * Site sessions (WP-07 T3; activities/site-workspace.ts): a session starts from the newest release (or the starter),
 * its save is the difference, and its end makes the next release. Task A writes about.html → release 1; task B,
 * started after, has about.html and adds pricing.html → release 2 holds both; two tasks from the same version changing
 * index.html: the second conflicts; a retried finish writes one release; a release with a script is held.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { screenSiteFiles, starterFiles } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applySiteChanges, buildSiteRelease, isSiteProject, siteCheckout } from "../activities/site-workspace";
import { saveWorkspace } from "../activities/workspace-store";
import { openSessionRow, setupOrchestratorHarness, type OrchestratorTestHarness } from "./harness";

const ENV = { SITES_DOMAIN: "sites.localhost" };
let t: OrchestratorTestHarness;
const dirs: string[] = [];
beforeAll(async () => {
  t = await setupOrchestratorHarness({ prefix: "site" });
}, 120_000);
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  await t?.h.close();
});
const freshDir = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), "fm-site-"));
  dirs.push(d);
  return d;
};

/** One site session: start from the site, write files, save against the base, build the release. */
async function session(taskId: string, write: Record<string, string>, remove: string[] = []) {
  const cwd = await freshDir();
  const started = await siteCheckout(t.db, t.businessId, cwd, new Date());
  for (const [p, text] of Object.entries(write)) await writeFile(path.join(cwd, p), text);
  for (const p of remove) await rm(path.join(cwd, p));
  const sessionId = await openSessionRow(t, t.workerId, taskId);
  await saveWorkspace(t.db, { businessId: t.businessId, taskId, sessionId, agentId: t.workerId, branch: `agent/${taskId}` }, cwd, { base: started.base });
  return { cwd, started, finish: () => buildSiteRelease(t.db, ENV, { businessId: t.businessId, taskId, sessionId, agentId: t.workerId, agentName: "Riley" }) };
}

describe("applySiteChanges", () => {
  const f = (p: string, sha: string) => ({ path: p, sha256: sha, size: 1 });
  const base = new Map([["index.html", "a"], ["about.html", "b"]]);
  it("adds, changes and removes on top of the newest release", () => {
    expect(applySiteChanges([f("index.html", "a"), f("about.html", "b")], base, [f("pricing.html", "c"), f("index.html", "a2")], ["about.html"])).toEqual({ files: [f("index.html", "a2"), f("pricing.html", "c")] });
  });
  it("conflicts when both sides changed or removed the same file", () => {
    expect(applySiteChanges([f("index.html", "x"), f("about.html", "b")], base, [f("index.html", "a2")], [])).toEqual({ conflict: ["index.html"] });
    expect(applySiteChanges([f("index.html", "a")], base, [], ["about.html"])).toEqual({ conflict: ["about.html"] });
  });
  it("lets a change on a file the other side never touched through", () => {
    expect(applySiteChanges([f("index.html", "a"), f("about.html", "b"), f("new.html", "n")], base, [f("about.html", "b2")], [])).toEqual({ files: [f("about.html", "b2"), f("index.html", "a"), f("new.html", "n")] });
  });
});

describe("site sessions", () => {
  it("is a site project only with Sites on and no repository", async () => {
    expect(await isSiteProject(t.db, ENV, t.businessId)).toBe(true);
    expect(await isSiteProject(t.db, {}, t.businessId)).toBe(false);
  });

  it("the starter passes screening", () => {
    expect(screenSiteFiles(starterFiles().map((f) => ({ path: f.path, size: f.content.length, text: f.content }))).flags).toEqual([]);
  });

  it("builds release 1 from the starter, then release 2 from release 1, and a retry writes no second release", async () => {
    const [taskA, taskB] = t.fixture.taskIds;
    const a = await session(taskA!, { "about.html": "<!doctype html><html><body><p>About us</p></body></html>" });
    expect(a.started.base.ref).toBe("starter");
    const first = await a.finish();
    expect(first).toMatchObject({ status: "release", release: { number: 1, state: "preview" }, flags: [] });
    expect(await a.finish()).toMatchObject({ status: "release", release: { id: first.status === "release" ? first.release.id : "", number: 1 } });
    expect((await repos.sites.listReleases(t.db, t.businessId)).length).toBe(1);

    const b = await session(taskB!, { "pricing.html": "<!doctype html><html><body><p>$5</p></body></html>" });
    expect(b.started.base.ref).toBe("r1");
    expect(await readFile(path.join(b.cwd, "about.html"), "utf8")).toContain("About us");
    const second = await b.finish();
    expect(second.status === "release" && second.release.files.map((f) => f.path).sort()).toEqual(["about.html", "index.html", "pricing.html", "styles.css"]);
    // The first preview wrote the note; the second, with no publish since, did not write another.
    expect(await repos.sites.openReadyNote(t.db, t.businessId)).toMatchObject({ subject: "Your site is ready to look at" });
  });

  it("hands back the second of two tasks that changed index.html from the same version", async () => {
    const [, , taskC, taskD] = t.fixture.taskIds;
    const c = await session(taskC!, { "index.html": "<!doctype html><html><body><h1>One</h1></body></html>" });
    const d = await session(taskD ?? taskC!, { "index.html": "<!doctype html><html><body><h1>Two</h1></body></html>" });
    expect((await c.finish()).status).toBe("release");
    expect(await d.finish()).toEqual({ status: "conflict", paths: ["index.html"] });
  });

  it("holds a release with a script, with the rule", async () => {
    const [taskA] = t.fixture.taskIds;
    const e = await session(taskA!, { "index.html": "<!doctype html><html><body><script>alert(1)</script></body></html>" });
    const built = await e.finish();
    expect(built).toMatchObject({ status: "release", release: { state: "held" }, flags: [{ rule: "script" }] });
  });
});
