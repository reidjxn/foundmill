/**
 * The hosted browser's E2B driver over a fake desktop sandbox: what it asks E2B for, in what order, and what it refuses.
 * Not run against E2B (a founder step once the key and template are set).
 */
import { describe, expect, it } from "vitest";
import { browserSite } from "@foundmill/connectors";
import { ALL_TRAFFIC, MAX_SANDBOX_MINUTES, NPM_REGISTRY, browserEgress, createE2bBrowserDriver, isLiveViewUrl, type DesktopSandbox } from "../browser-e2b";

const SITE = browserSite("wave")!;

function fake(over: { node?: number; answer?: (req: { op: string }) => unknown } = {}) {
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
        if (cmd.startsWith("node --version")) return { exitCode: over.node ?? 0, stdout: "v22", stderr: "" };
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
  const driver = createE2bBrowserDriver({ apiKey: "e2b_test", factory: async (input) => (created.push(input), sbx) });
  return { driver, log, files, created, killed: () => killed };
}

describe("the E2B browser driver", () => {
  it("installs the browser with the registry open, then narrows egress to the site before any page", async () => {
    const f = fake();
    const opened = await f.driver.open({ businessId: "b1", site: SITE, contextId: "new", minutes: 20, save: true });
    expect(f.created[0]).toMatchObject({ template: "desktop", timeoutMs: 21 * 60_000, network: { allowOut: [NPM_REGISTRY], denyOut: [ALL_TRAFFIC] }, metadata: { kind: "hosted-browser", site: "wave" } });
    const install = f.log.findIndex((l) => l.startsWith("run mkdir"));
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

  it("kills the sandbox when it cannot start the browser", async () => {
    const f = fake({ node: 127 });
    await expect(f.driver.open({ businessId: "b1", site: SITE, contextId: "new", minutes: 20, save: false })).rejects.toThrow(/no Node/);
    expect(f.killed()).toBe(true);
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
