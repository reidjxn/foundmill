/**
 * The hosted browser's E2B driver over a fake desktop sandbox: what it asks E2B for, in what order, and what it refuses.
 * Not run against E2B (a founder step once the key and template are set).
 */
import { describe, expect, it } from "vitest";
import { browserSite } from "@foundmill/connectors";
import { ALL_TRAFFIC, MAX_SANDBOX_MINUTES, NPM_REGISTRY, browserEgress, createE2bBrowserDriver, isLiveViewUrl, type DesktopSandbox } from "../browser-e2b";

const SITE = browserSite("wave")!;

function fake(over: { node?: number; templateLib?: boolean; create?: Error; answer?: (req: { op: string }) => unknown } = {}) {
  const log: string[] = [];
  const files = new Map<string, string>();
  let killed = false;
  const answer = over.answer ?? ((req: { op: string }) => (req.op === "state" ? { ok: true, state: JSON.stringify({ cookies: [], origins: [] }) } : req.op === "goto" ? { ok: true, url: "https://next.waveapps.com/" } : { ok: true }));
  const created: unknown[] = [];
  const sbx: DesktopSandbox = {
    sandboxId: "isample0000000001",
    commands: {
      run: async (cmd, opts) => {
        log.push(`run ${cmd.split(" ").slice(0, 2).join(" ")}${opts?.background ? " (background)" : ""}`);
        // The SDK throws on a non-zero exit, with the result on the error.
        const exit = (exitCode: number) => {
          if (exitCode === 0) return { exitCode, stdout: "v22", stderr: "" };
          throw Object.assign(new Error(`exit status ${exitCode}`), { name: "CommandExitError", exitCode, stdout: "", stderr: "sh: 1: node: not found" });
        };
        if (cmd.startsWith("node --version")) return exit(over.node ?? 0);
        if (cmd.startsWith("test -f /opt/fm-browser")) return exit(over.templateLib === false ? 1 : 0);
        if (cmd.includes("call.mjs")) {
          const file = cmd.split(" ").at(-1)!.replace(/'/g, "");
          return { exitCode: 0, stdout: JSON.stringify(answer(JSON.parse(files.get(file)!))), stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    },
    files: { write: async (p, d) => void files.set(p, d) },
    updateNetwork: async (n) => void log.push(`network ${JSON.stringify(n)}`),
    stream: { start: async (o) => void log.push(`stream ${JSON.stringify(o)}`), getAuthKey: () => "k", getUrl: () => "https://6080-isample0000000001.e2b.app/vnc.html?password=k" },
    kill: async () => void (killed = true),
  };
  const warnings: string[] = [];
  const driver = createE2bBrowserDriver({ apiKey: "e2b_test", log: { warn: (o) => void warnings.push(JSON.stringify(o)) }, factory: async (input) => {
    if (over.create) throw over.create;
    return (created.push(input), sbx);
  } });
  return { driver, log, files, created, warnings, killed: () => killed };
}

describe("the E2B browser driver", () => {
  it("uses the template's own playwright-core, and narrows egress to the site before the browser starts", async () => {
    const f = fake();
    await f.driver.open({ businessId: "b1", site: SITE, contextId: "new", minutes: 20, save: true });
    expect(f.created[0]).toMatchObject({ template: "foundmill-browser" });
    expect(f.log.some((l) => l.startsWith("run cd"))).toBe(false);
    expect(f.log.findIndex((l) => l.startsWith("network"))).toBeLessThan(f.log.findIndex((l) => l.includes("(background)")));
  });

  it("without the template's library, installs it with the registry open, then narrows egress before any page", async () => {
    const f = fake({ templateLib: false });
    const opened = await f.driver.open({ businessId: "b1", site: SITE, contextId: "new", minutes: 20, save: true });
    expect(f.created[0]).toMatchObject({ template: "foundmill-browser", timeoutMs: 21 * 60_000, network: { allowOut: [NPM_REGISTRY], denyOut: [ALL_TRAFFIC] }, metadata: { kind: "hosted-browser", site: "wave" } });
    const install = f.log.findIndex((l) => l.startsWith("run cd"));
    const narrow = f.log.findIndex((l) => l.startsWith("network"));
    const server = f.log.findIndex((l) => l.includes("(background)"));
    expect(install).toBeGreaterThan(-1);
    expect(narrow).toBeGreaterThan(install);
    expect(server).toBeGreaterThan(narrow);
    expect(f.log[narrow]).toBe(`network ${JSON.stringify({ allowOut: browserEgress(SITE), denyOut: [ALL_TRAFFIC] })}`);
    expect(browserEgress(SITE)).not.toContain(NPM_REGISTRY);
    expect(f.log).toContain('stream {"requireAuth":true}');
    expect(isLiveViewUrl(opened.liveViewUrl)).toBe(true);
  });

  it("stays inside E2B Hobby's one-hour cap", async () => {
    const f = fake();
    await f.driver.open({ businessId: "b1", site: SITE, contextId: "new", minutes: 600, save: false });
    expect((f.created[0] as { timeoutMs: number }).timeoutMs).toBe(MAX_SANDBOX_MINUTES * 60_000);
  });

  it("passes a saved sign-in in a file, exports it at Done, and kills the sandbox on close", async () => {
    const f = fake();
    const saved = JSON.stringify({ cookies: [{ name: "s" }], origins: [] });
    const { id } = await f.driver.open({ businessId: "b1", site: SITE, contextId: saved, minutes: 20, save: false });
    expect([...f.files.values()]).toContain(saved);
    expect(await f.driver.exportState!(id)).toBe(JSON.stringify({ cookies: [], origins: [] }));
    await f.driver.close(id);
    expect(f.killed()).toBe(true);
    await expect(f.driver.goto(id, "https://next.waveapps.com/")).rejects.toThrow(/ended/);
  });

  it("says why when the template has no Node (the SDK throws on the exit), logs it, and kills the sandbox", async () => {
    const f = fake({ node: 127 });
    await expect(f.driver.open({ businessId: "b1", site: SITE, contextId: "new", minutes: 20, save: false })).rejects.toThrow(/has no Node \(build infra\/e2b\/browser.Dockerfile/);
    expect(f.killed()).toBe(true);
    expect(f.warnings.join(" ")).toContain("has no Node");
  });

  it("says why when E2B refuses the sandbox, never only that it could not be reached", async () => {
    const missing = fake({ create: Object.assign(new Error("template 'foundmill-browser' not found"), { name: "NotFoundError" }) });
    await expect(missing.driver.open({ businessId: "b1", site: SITE, contextId: "new", minutes: 20, save: false })).rejects.toThrow(/could not start the template "foundmill-browser"/);
    const auth = fake({ create: Object.assign(new Error("Invalid API key"), { name: "AuthenticationError" }) });
    await expect(auth.driver.open({ businessId: "b1", site: SITE, contextId: "new", minutes: 20, save: false })).rejects.toThrow(/E2B refused the key/);
    expect(auth.warnings.join(" ")).not.toContain("e2b_test");
  });

  it("refuses a step the page answers with a change, and keeps nothing at E2B for a saved sign-in", async () => {
    const f = fake({ answer: (r) => (r.op === "act" ? { ok: false, status: 409, message: "the page changed since it was read; read it again" } : { ok: true }) });
    const { id } = await f.driver.open({ businessId: "b1", site: SITE, contextId: "new", minutes: 20, save: false });
    await expect(f.driver.act(id, { action: "click", index: 0, expect: { role: "button", label: "Save" } })).rejects.toMatchObject({ httpStatus: 409 });
    expect(await f.driver.deleteContext("anything")).toBe(true);
    expect(await f.driver.contextExists("not json")).toBe(false);
    expect(await f.driver.contextExists(JSON.stringify({ cookies: [] }))).toBe(true);
  });

  it("frames only E2B's own sandbox hosts", () => {
    expect(isLiveViewUrl("https://6080-isample0000000001.e2b.app/vnc.html")).toBe(true);
    for (const u of ["http://6080-isample0000000001.e2b.app/", "https://evil.example/", "https://6080-x.e2b.app.evil.net/", "https://app.foundmill.example/", "javascript:alert(1)", null]) expect(isLiveViewUrl(u), String(u)).toBe(false);
  });
});
