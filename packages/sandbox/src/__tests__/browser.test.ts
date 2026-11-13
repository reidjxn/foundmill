import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAPTURE_SCRIPT, capturePages, IMAGE_NODE_ROOTS, isPngBase64, MAX_CAPTURE_OUTPUT_BYTES, MAX_SHOT_BASE64_CHARS, NO_BROWSER_EXIT, NOT_SERVING_EXIT, safeRoute, SIMULATED_CAPTURE_NOTICE, STATIC_SERVER_SCRIPT } from "../browser";
import { MockSandboxProvider } from "../mock/replay";
import type { ExecResult, Sandbox, SandboxMode } from "../types";

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "", timedOut: false, durationMs: 1 });

interface CaptureConfig {
  out: string;
  pages: string[];
  playwrightDir: string;
  imageNodeRoots: string[];
}

/**
 * A sandbox that records commands and answers the capture run with `onCapture` (given the capture's config, it returns
 * the output lines and the exit). `stat -c %s` reports the output's size, or `reportedSize` when set.
 */
function fakeSandbox(onCapture: (files: Map<string, string>, cfg: CaptureConfig) => ExecResult, opts: { provider?: SandboxMode; reportedSize?: number } = {}) {
  const provider = opts.provider ?? "docker";
  const files = new Map<string, string>();
  const commands: string[] = [];
  const reads: string[] = [];
  const configs: CaptureConfig[] = [];
  const sandbox: Sandbox = {
    id: "sb1",
    provider,
    spec: { businessId: "b", taskId: "t", egressAllowList: [], envShortLived: {}, ttlMinutes: 30 },
    workdir: "/workspace",
    state: "running",
    async start() {},
    async exec(cmd) {
      commands.push(cmd);
      if (cmd.includes("capture.mjs")) {
        const cfgPath = /node \S+capture\.mjs (\S+)/.exec(cmd)![1]!;
        const cfg = JSON.parse(files.get(cfgPath)!) as CaptureConfig;
        configs.push(cfg);
        return onCapture(files, cfg);
      }
      const stat = /^stat -c %s (\S+)/.exec(cmd);
      if (stat) return ok(String(opts.reportedSize ?? files.get(stat[1]!)?.length ?? 0));
      return ok();
    },
    async writeFile(p, content) {
      files.set(p, typeof content === "string" ? content : new TextDecoder().decode(content));
    },
    async readFile(p) {
      reads.push(p);
      const f = files.get(p);
      if (f === undefined) throw new Error(`no file ${p}`);
      return f;
    },
    async listFiles() {
      return [];
    },
    async snapshot() {
      return { id: "s", sandboxId: "sb1", provider, ref: "r", createdAt: new Date(0).toISOString() };
    },
    async closeEgress() {},
    async stop() {},
  };
  return { sandbox, files, commands, reads, configs };
}

const writeLines = (lines: unknown[]) => (f: Map<string, string>, cfg: CaptureConfig) => {
  f.set(cfg.out, lines.map((l) => JSON.stringify(l)).join("\n"));
  return ok();
};

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const description = (page: string, viewport: "desktop" | "phone") => ({ page, viewport, widthPx: viewport === "phone" ? 390 : 1440, scrollWidthPx: 1440, title: "Shop", elements: [{ ref: "main > h1", role: "heading", level: 1, text: "Shop", fontSizePx: 32, color: "rgb(0, 0, 0)", background: "rgb(255, 255, 255)" }] });

describe("capturePages (the sandbox's browser capability)", () => {
  it("in mock mode takes no screenshot and says it was simulated", async () => {
    const provider = new MockSandboxProvider();
    const sandbox = await provider.create({ businessId: "b", taskId: "t" });
    const r = await capturePages(sandbox, { pages: ["/", "/pricing"], serve: { command: "npm run dev", port: 3000 } });
    expect(r).toEqual({ status: "simulated", notice: SIMULATED_CAPTURE_NOTICE, pages: [{ page: "/", viewport: "desktop" }, { page: "/", viewport: "phone" }, { page: "/pricing", viewport: "desktop" }, { page: "/pricing", viewport: "phone" }] });
    expect(r.status === "simulated" && "shots" in r).toBe(false);
  });

  it("reads each shot and its page description, and records pages that failed", async () => {
    const { sandbox, commands, configs } = fakeSandbox(
      writeLines([
        { page: "/", viewport: "desktop", ok: true, width: 1440, height: 900, cut: false, png: PNG, description: description("/", "desktop") },
        { page: "/", viewport: "phone", ok: true, width: 390, height: 2532, cut: true, png: PNG, description: description("/", "phone") },
        { page: "/pricing", viewport: "desktop", ok: false, reason: "Timeout 30000ms exceeded" },
        { page: "/pricing", viewport: "phone", ok: true, width: 390, height: 844, png: "!!not base64!!" },
      ]),
    );
    const r = await capturePages(sandbox, { pages: ["/", "/pricing", "https://evil.example/", "/"], serve: { command: "pnpm dev", port: 3000 }, label: "before" });
    expect(r.status).toBe("captured");
    if (r.status !== "captured") return;
    expect(r.shots.map((s) => [s.id, s.page, s.viewport, s.cut])).toEqual([
      ["before-1-desktop", "/", "desktop", false],
      ["before-1-phone", "/", "phone", true],
    ]);
    expect(r.shots[0]!.description?.elements[0]?.text).toBe("Shop");
    expect(r.failed).toEqual([
      { page: "/pricing", viewport: "desktop", reason: "Timeout 30000ms exceeded" },
      { page: "/pricing", viewport: "phone", reason: "what came back is not a PNG screenshot" },
    ]);
    // The off-site route is dropped before it reaches the browser; the server is started in the background and stopped after.
    expect(configs[0]!.pages).toEqual(["/", "/pricing"]);
    expect(commands.some((c) => c.includes("setsid nohup sh -c 'pnpm dev'") && c.includes("PORT=3000"))).toBe(true);
    expect(commands.at(-1)).toMatch(/kill -- -\$\(cat \/tmp\/fm-capture\/serve.pid\)/);
  });

  it("says plainly when the image has no browser or the project never started", async () => {
    const noBrowser = fakeSandbox(() => ({ code: NO_BROWSER_EXIT, stdout: "", stderr: "FM_NO_BROWSER", timedOut: false, durationMs: 1 }));
    const a = await capturePages(noBrowser.sandbox, { pages: ["/"], serve: { command: "npm start", port: 3000 } });
    expect(a).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/no browser/) });
    const notServing = fakeSandbox((f) => {
      f.set("/tmp/fm-capture/serve.log", "Error: Cannot find module 'next'\n");
      return { code: NOT_SERVING_EXIT, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
    });
    const b = await capturePages(notServing.sandbox, { pages: ["/"], serve: { command: "npm start", port: 3000 } });
    expect(b).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/did not start on port 3000: Error: Cannot find module 'next'/) });
    const nothing = await capturePages(fakeSandbox(() => ok()).sandbox, { pages: ["javascript:alert(1)"], serve: { command: "npm start", port: 3000 } });
    expect(nothing).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/no page to open/) });
  });

  it("opens only paths on the project's own server", () => {
    expect(safeRoute("/pricing?plan=pro")).toBe("/pricing?plan=pro");
    expect(safeRoute("//evil.example")).toBeNull();
    expect(safeRoute("https://evil.example")).toBeNull();
    expect(safeRoute("/a b")).toBeNull();
    expect(safeRoute("/'; rm -rf /")).toBeNull();
  });
});

describe("capture security (review of the design check)", () => {
  it("finding 2: an output over the size limit is refused unread, and an oversized screenshot is not a shot", async () => {
    const huge = fakeSandbox(writeLines([{ page: "/", viewport: "desktop", ok: true, width: 1440, height: 900, png: PNG }]), { reportedSize: MAX_CAPTURE_OUTPUT_BYTES + 1 });
    const r = await capturePages(huge.sandbox, { pages: ["/"], viewports: ["desktop"], serve: { command: "npm start", port: 3000 } });
    expect(r).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/over the 48 MB limit, so it was not read/) });
    expect(huge.reads.some((p) => p.endsWith(".jsonl"))).toBe(false);

    const tooBig = PNG + "A".repeat(MAX_SHOT_BASE64_CHARS);
    const big = fakeSandbox(writeLines([{ page: "/", viewport: "desktop", ok: true, width: 1440, height: 900, png: tooBig }]));
    const b = await capturePages(big.sandbox, { pages: ["/"], viewports: ["desktop"], serve: { command: "npm start", port: 3000 } });
    expect(b).toMatchObject({ status: "captured", shots: [], failed: [{ page: "/", viewport: "desktop", reason: "the screenshot could not be read (too large or malformed)" }] });
  });

  it("finding 3: only PNGs are screenshots", async () => {
    expect(isPngBase64(PNG)).toBe(true);
    expect(isPngBase64(GIF)).toBe(false);
    expect(isPngBase64("iVBORw0KGgo")).toBe(false);
    const gif = fakeSandbox(writeLines([{ page: "/", viewport: "desktop", ok: true, width: 1440, height: 900, png: GIF }]));
    const r = await capturePages(gif.sandbox, { pages: ["/"], viewports: ["desktop"], serve: { command: "npm start", port: 3000 } });
    expect(r).toMatchObject({ status: "captured", shots: [], failed: [{ page: "/", viewport: "desktop", reason: "what came back is not a PNG screenshot" }] });
  });

  it("finding 4: Playwright only from the image, the capture run outside the project, at a fresh path each time", async () => {
    // The script never resolves modules from the working directory or a path the environment names.
    expect(CAPTURE_SCRIPT).not.toMatch(/process\.cwd\(\)|FM_NPM_ROOT|process\.env\.(?!PLAYWRIGHT)/);
    const f = fakeSandbox(writeLines([{ page: "/", viewport: "desktop", ok: true, width: 1440, height: 900, png: PNG }]));
    await capturePages(f.sandbox, { pages: ["/"], viewports: ["desktop"], serve: { command: "npm start", port: 3000, cwd: "/workspace/apps/web" } });
    await capturePages(f.sandbox, { pages: ["/"], viewports: ["desktop"], serve: { command: "npm start", port: 3000, cwd: "/workspace/apps/web" } });
    const [a, b] = f.configs;
    expect(a!.imageNodeRoots).toEqual([...IMAGE_NODE_ROOTS]);
    expect(a!.out).toMatch(/^\/tmp\/fm-run-[0-9a-f-]{36}\/[0-9a-f-]{36}\.jsonl$/);
    expect(a!.out).not.toBe(b!.out);
    expect(path.dirname(a!.out)).not.toBe(path.dirname(b!.out));
    const run = f.commands.find((c) => c.includes("capture.mjs"))!;
    expect(run).toMatch(/^cd \/tmp\/fm-run-[0-9a-f-]{36} && /);
    expect(run).not.toContain("/workspace");
    expect(run).not.toContain("npm root");
    // The run directory is made after the project's server starts, private, and removed after.
    const serveAt = f.commands.findIndex((c) => c.includes("setsid"));
    const mkdirAt = f.commands.findIndex((c) => /mkdir -m 700 \/tmp\/fm-run-/.test(c));
    expect(mkdirAt).toBeGreaterThan(serveAt);
    expect(f.commands.at(-1)).toMatch(/rm -rf \/tmp\/fm-run-/);
  });
});

/** A free local port. */
async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

describe("the static server (finding 6)", () => {
  it("answers a bad escape with 400 and keeps serving, and never serves a symlink out of its directory", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fm-static-"));
    const site = path.join(tmp, "site");
    await fs.mkdir(site);
    await fs.writeFile(path.join(site, "index.html"), "<h1>Loaf</h1>");
    await fs.writeFile(path.join(tmp, "secret.txt"), "the database password");
    await fs.symlink(path.join(tmp, "secret.txt"), path.join(site, "leak.html"));
    await fs.writeFile(path.join(tmp, "static.mjs"), STATIC_SERVER_SCRIPT);
    const port = await freePort();
    let child: ChildProcess | null = null;
    try {
      child = spawn(process.execPath, [path.join(tmp, "static.mjs"), site, String(port)], { stdio: "ignore" });
      const base = `http://127.0.0.1:${port}`;
      for (let i = 0; i < 100; i++) {
        if (await fetch(`${base}/`).then(() => true, () => false)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect((await fetch(`${base}/%E0%A4%A`)).status).toBe(400);
      // Still up after the bad request.
      const home = await fetch(`${base}/`);
      expect(home.status).toBe(200);
      expect(await home.text()).toContain("Loaf");
      const leak = await fetch(`${base}/leak.html`);
      expect(leak.status).toBe(404);
      expect(await leak.text()).not.toContain("password");
      expect((await fetch(`${base}/..%2fsecret.txt`)).status).toBe(404);
    } finally {
      child?.kill();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
