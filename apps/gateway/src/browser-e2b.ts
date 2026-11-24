/**
 * The hosted browser's live driver: an E2B desktop sandbox with Chrome (founder, Nov 22, 2026: E2B in place of
 * Browserbase). One sandbox per browser session, of its own kind: never the project's CLI-Anything sandbox, never reused.
 *
 * - **Network.** The sandbox starts able to reach the npm registry only, installs playwright-core (pinned), and then,
 *   before any page opens, its egress is narrowed to the site's own hosts and their subdomains (pages load their
 *   assets from them). Navigation stays on the site's exact hosts: the connector checks every address.
 * - **The page.** A small server inside the sandbox drives the visible Chrome through Playwright and answers one JSON
 *   request at a time on 127.0.0.1. The gateway reaches it only through E2B's command API, never over a public port.
 * - **The live view.** E2B's desktop stream (noVNC) with its own generated password. Whoever holds the address
 *   controls the session, so the gateway hands it only to the api, and the api only to someone who may control it.
 * - **The saved sign-in** is the browser's sign-in state (cookies and storage), exported when the founder presses Done
 *   and sealed in Foundmill's own vault. Nothing stays at E2B: the sandbox is killed when its session ends.
 * - **Time.** E2B's Hobby plan caps a sandbox at one hour; a session asks for its own limit plus a minute, never more
 *   than 55 minutes, and ends as a checkpoint before that.
 * - **CAPTCHAs.** Nothing here solves one: the page reports a bot check and the agent hands it to the founder.
 *
 * The key is `E2B_API_KEY`, on the gateway only. Not run against E2B in tests: `browser-e2b.test.ts` drives it over a
 * fake sandbox. The first live run is a founder step.
 */
import { randomBytes } from "node:crypto";
import { PAGE_FUNCTIONS, VendorError, type BrowserDriver, type BrowserSite, type RawSnapshot } from "@foundmill/connectors";

/** The parts of an E2B desktop sandbox this driver uses (`@e2b/desktop` `Sandbox`). */
export interface DesktopSandbox {
  readonly sandboxId: string;
  commands: { run(cmd: string, opts?: { background?: boolean; timeoutMs?: number; envs?: Record<string, string> }): Promise<{ exitCode: number; stdout: string; stderr: string }> };
  files: { write(path: string, data: string): Promise<unknown> };
  updateNetwork(network: { allowOut?: string[]; denyOut?: string[] }): Promise<void>;
  stream: { start(opts?: { requireAuth?: boolean }): Promise<void>; getAuthKey(): string; getUrl(opts?: { authKey?: string; viewOnly?: boolean; resize?: "off" | "scale" | "remote" }): string };
  kill(): Promise<unknown>;
}
export type DesktopFactory = (input: { template: string; timeoutMs: number; network: { allowOut: string[]; denyOut: string[] }; metadata: Record<string, string> }) => Promise<DesktopSandbox>;

/** Built from infra/e2b/browser.Dockerfile: E2B's public `desktop` template has no Node and no browser Playwright can drive. */
export const E2B_BROWSER_DEFAULT_TEMPLATE = "foundmill-browser";
/** Where that template keeps playwright-core; without it, the session installs it from the registry before egress narrows. */
export const TEMPLATE_LIB = "/opt/fm-browser";
export const ALL_TRAFFIC = "0.0.0.0/0";
export const NPM_REGISTRY = "registry.npmjs.org";
export const PLAYWRIGHT_CORE = "playwright-core@1.63.0";
/** E2B Hobby's one-hour cap, with room to end cleanly. */
export const MAX_SANDBOX_MINUTES = 55;
const DIR = "/tmp/fm-browser";
const PORT = 9333;
const STEP_MS = 45_000;

/** Where the sandbox may connect once the browser runs: the site's hosts and their subdomains, nothing else. */
export function browserEgress(site: Pick<BrowserSite, "hosts" | "signInHosts">): string[] {
  const hosts = [...site.hosts, ...(site.signInHosts ?? [])];
  return [...new Set(hosts.flatMap((h) => [h, `*.${h}`]))];
}

/** The server that runs inside the sandbox. It reads the saved sign-in from a file it deletes, and serves 127.0.0.1 only. */
export const SERVER_SCRIPT = `
import http from "node:http";
import { readFile, rm } from "node:fs/promises";
const { chromium } = await import(process.env.FM_LIB + "/node_modules/playwright-core/index.mjs");
${PAGE_FUNCTIONS}
let state;
try { state = JSON.parse(await readFile("${DIR}/state.json", "utf8")); } catch {}
await rm("${DIR}/state.json", { force: true });
const launchArgs = { headless: false, args: ["--start-maximized", "--no-first-run", "--no-default-browser-check", "--disable-features=Translate"] };
// Playwright's own Chromium (the foundmill-browser template), else an installed Google Chrome.
const browser = await chromium.launch(launchArgs).catch(() => chromium.launch({ ...launchArgs, channel: "chrome" }));
const context = await browser.newContext({ viewport: null, ...(state ? { storageState: state } : {}) });
const page = await context.newPage();
// One page per session: a window the site opens is closed, so a step never continues somewhere unseen.
context.on("page", (p) => { if (p !== page) p.close().catch(() => {}); });
page.on("dialog", (d) => d.dismiss().catch(() => {}));
let stamp = "";
const settled = async () => { await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {}); return page.url(); };
const fail = (status, message) => Object.assign(new Error(message), { status });
const ops = {
  ping: async () => ({}),
  goto: async ({ url }) => { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); return { url: page.url() }; },
  snapshot: async ({ stamp: s }) => { await settled(); stamp = s; return { snap: { url: page.url(), ...(await page.evaluate(readPage, { max: 400, stamp: s })) } }; },
  act: async ({ action, index, expect, value, file }) => {
    const selector = '[data-fm-ref="' + stamp + "-" + index + '"]';
    // The page may have re-rendered since it was read: only the one element that still carries this read's stamp, and
    // still says what was classified, is acted on.
    if ((await page.evaluate(stampedLabel, selector)) !== expect.label) throw fail(409, "the page changed since it was read; read it again");
    const target = page.locator(selector);
    if (action === "fill") await target.fill(value ?? "", { timeout: 15000 });
    else if (action === "upload_file") await target.setInputFiles(file ? { name: file.name, mimeType: "application/octet-stream", buffer: Buffer.from(file.base64, "base64") } : [], { timeout: 15000 });
    else if (action === "select") {
      if ((await target.evaluate((el) => el.tagName)) === "SELECT") await target.selectOption({ label: value ?? "" }, { timeout: 15000 });
      else await target.setChecked(!/^(off|no|false|0)$/i.test(value ?? "on"), { timeout: 15000 });
    } else await target.click({ timeout: 15000 });
    return { url: await settled() };
  },
  screenshot: async () => ({ png: (await page.screenshot({ type: "png", timeout: 15000 })).toString("base64") }),
  state: async () => ({ state: JSON.stringify(await context.storageState()) }),
};
http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  try {
    const { op, ...args } = JSON.parse(body);
    if (!Object.hasOwn(ops, op)) throw fail(400, "unknown op");
    res.end(JSON.stringify({ ok: true, ...(await ops[op](args)) }));
  } catch (e) {
    res.end(JSON.stringify({ ok: false, status: typeof e.status === "number" ? e.status : 500, message: String(e && e.message).slice(0, 300) }));
  }
}).listen(${PORT}, "127.0.0.1");
`;

/** Posts one request file to the server and prints the answer. */
export const CALL_SCRIPT = `
import { readFile, rm } from "node:fs/promises";
const file = process.argv[2];
const body = await readFile(file, "utf8");
await rm(file, { force: true });
const res = await fetch("http://127.0.0.1:${PORT}/", { method: "POST", body });
process.stdout.write(await res.text());
`;

const shellArg = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The largest saved sign-in sealed in the vault; a site that stores more than this in the browser is refused. */
export const MAX_STATE_BYTES = 512 * 1024;

interface Live {
  sbx: DesktopSandbox;
  calls: number;
}

async function realFactory(apiKey: string): Promise<DesktopFactory> {
  const { Sandbox } = await import("@e2b/desktop");
  return async ({ template, timeoutMs, network, metadata }) => (await Sandbox.create(template, { apiKey, timeoutMs, network, metadata })) as unknown as DesktopSandbox;
}

/** A command's result whatever its exit code: the SDK throws `CommandExitError` for a non-zero one, which carries the result. */
async function run(sbx: DesktopSandbox, cmd: string, opts?: Parameters<DesktopSandbox["commands"]["run"]>[1]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    return await sbx.commands.run(cmd, opts);
  } catch (e) {
    const r = e as { exitCode?: unknown; stdout?: unknown; stderr?: unknown };
    if (typeof r.exitCode === "number") return { exitCode: r.exitCode, stdout: typeof r.stdout === "string" ? r.stdout : "", stderr: typeof r.stderr === "string" ? r.stderr : "" };
    throw e;
  }
}

/** What went wrong at E2B, in words the founder's operator can act on. E2B's messages carry no key. */
export function e2bReason(e: unknown, template: string): string {
  const name = e instanceof Error ? e.name : "";
  const message = e instanceof Error ? e.message.replace(/\s+/g, " ").slice(0, 240) : String(e).slice(0, 240);
  if (name === "AuthenticationError") return "E2B refused the key (E2B_API_KEY on the gateway)";
  if (name === "NotFoundError" || name === "TemplateError" || /template/i.test(message)) return `E2B could not start the template "${template}" (build it from infra/e2b/browser.Dockerfile, or set E2B_BROWSER_TEMPLATE): ${message}`;
  if (name === "RateLimitError") return "E2B is limiting how many sandboxes start; try again in a minute";
  if (name === "TimeoutError") return `E2B timed out: ${message}`;
  return `${name || "Error"}: ${message}`;
}

export function createE2bBrowserDriver(config: { apiKey: string; template?: string; factory?: DesktopFactory; log?: { warn(o: object, msg: string): void } }): BrowserDriver {
  const live = new Map<string, Live>();
  const template = config.template || E2B_BROWSER_DEFAULT_TEMPLATE;
  let factory: Promise<DesktopFactory> | null = config.factory ? Promise.resolve(config.factory) : null;
  const factoryOf = () => (factory ??= realFactory(config.apiKey));
  const KEY = "browser";
  const must = (id: string): Live => {
    const l = live.get(id);
    if (!l) throw new VendorError(KEY, 410, "the browser session has ended");
    return l;
  };
  const call = async <T>(id: string, op: string, args: Record<string, unknown> = {}): Promise<T> => {
    const l = must(id);
    const file = `${DIR}/req-${++l.calls}.json`;
    await l.sbx.files.write(file, JSON.stringify({ op, ...args }));
    const r = await run(l.sbx, `node ${DIR}/call.mjs ${shellArg(file)}`, { timeoutMs: STEP_MS });
    let out: { ok: boolean; status?: number; message?: string } & Record<string, unknown>;
    try {
      out = JSON.parse(r.stdout);
    } catch {
      throw new VendorError(KEY, 502, "the browser in the sandbox did not answer");
    }
    if (!out.ok) throw new VendorError(KEY, out.status ?? 500, out.message ?? "the browser step failed");
    return out as T;
  };
  return {
    // The saved sign-in is the browser's own state, sealed by Foundmill: nothing is created or kept at E2B.
    createContext: async () => "new",
    deleteContext: async () => true,
    contextExists: async (state) => {
      try {
        return Array.isArray((JSON.parse(state) as { cookies?: unknown }).cookies);
      } catch {
        return false;
      }
    },
    open: async ({ businessId, site, contextId, minutes }) => {
      const timeoutMs = Math.min(MAX_SANDBOX_MINUTES, Math.ceil(minutes) + 1) * 60_000;
      let sbx: DesktopSandbox;
      try {
        sbx = await (await factoryOf())({ template, timeoutMs, network: { allowOut: [NPM_REGISTRY], denyOut: [ALL_TRAFFIC] }, metadata: { kind: "hosted-browser", businessId, site: site.key } });
      } catch (e) {
        const reason = e2bReason(e, template);
        config.log?.warn({ template, site: site.key, error: e instanceof Error ? e.name : "unknown", reason }, "hosted browser: the sandbox did not start");
        throw new VendorError(KEY, 502, reason);
      }
      const id = sbx.sandboxId;
      try {
        const node = await run(sbx, "node --version", { timeoutMs: 10_000 });
        if (node.exitCode !== 0) throw new VendorError(KEY, 503, `the template "${template}" has no Node (build infra/e2b/browser.Dockerfile as foundmill-browser)`);
        await run(sbx, `mkdir -p ${DIR}`, { timeoutMs: 10_000 });
        // The template's own playwright-core, else one installed now, while the registry is the only host it can reach.
        let lib = TEMPLATE_LIB;
        if ((await run(sbx, `test -f ${TEMPLATE_LIB}/node_modules/playwright-core/index.mjs`, { timeoutMs: 10_000 })).exitCode !== 0) {
          lib = DIR;
          const install = await run(sbx, `cd ${DIR} && npm install --no-save --ignore-scripts --no-audit --no-fund ${PLAYWRIGHT_CORE}`, { timeoutMs: 120_000 });
          if (install.exitCode !== 0) throw new VendorError(KEY, 503, `the browser could not be prepared in the sandbox: ${install.stderr.replace(/\s+/g, " ").slice(-200)}`);
        }
        // From here on the sandbox reaches the site and nothing else, before any page of it opens.
        await sbx.updateNetwork({ allowOut: browserEgress(site), denyOut: [ALL_TRAFFIC] });
        if (contextId !== "new") {
          if (Buffer.byteLength(contextId, "utf8") > MAX_STATE_BYTES) throw new VendorError(KEY, 413, "the saved sign-in is too large");
          await sbx.files.write(`${DIR}/state.json`, contextId);
        }
        await sbx.files.write(`${DIR}/server.mjs`, SERVER_SCRIPT);
        await sbx.files.write(`${DIR}/call.mjs`, CALL_SCRIPT);
        await sbx.commands.run(`node ${DIR}/server.mjs > ${DIR}/server.log 2>&1`, { background: true, envs: { DISPLAY: ":0", FM_LIB: lib } });
        live.set(id, { sbx, calls: 0 });
        let ready = false;
        for (let i = 0; i < 30 && !ready; i++) {
          ready = await call(id, "ping").then(
            () => true,
            () => false,
          );
          if (!ready) await new Promise((r) => setTimeout(r, 1_000));
        }
        if (!ready) {
          const tail = (await run(sbx, `tail -c 400 ${DIR}/server.log`, { timeoutMs: 10_000 }).catch(() => ({ stdout: "" }))).stdout.replace(/\s+/g, " ").trim();
          throw new VendorError(KEY, 503, `the browser in the sandbox did not start${tail ? `: ${tail}` : ""}`);
        }
        await sbx.stream.start({ requireAuth: true });
        return { id, liveViewUrl: sbx.stream.getUrl({ authKey: sbx.stream.getAuthKey(), resize: "scale" }) };
      } catch (e) {
        live.delete(id);
        await sbx.kill().catch(() => undefined);
        const reason = e instanceof VendorError ? e.message : e2bReason(e, template);
        config.log?.warn({ template, site: site.key, error: e instanceof Error ? e.name : "unknown", reason }, "hosted browser: the session did not open");
        throw e instanceof VendorError ? e : new VendorError(KEY, 502, reason);
      }
    },
    goto: async (id, url) => (await call<{ url: string }>(id, "goto", { url })).url,
    snapshot: async (id) => (await call<{ snap: RawSnapshot }>(id, "snapshot", { stamp: randomBytes(6).toString("hex") })).snap,
    act: async (id, step) => (await call<{ url: string }>(id, "act", { action: step.action, index: step.index, expect: step.expect, ...(step.value !== undefined ? { value: step.value } : {}), ...(step.file ? { file: { name: step.file.name, base64: Buffer.from(step.file.bytes).toString("base64") } } : {}) })).url,
    screenshot: async (id) => new Uint8Array(Buffer.from((await call<{ png: string }>(id, "screenshot")).png, "base64")),
    exportState: async (id) => {
      const { state } = await call<{ state: string }>(id, "state");
      if (Buffer.byteLength(state, "utf8") > MAX_STATE_BYTES) throw new VendorError(KEY, 413, "this site keeps more in the browser than a saved sign-in can hold");
      return state;
    },
    close: async (id) => {
      const l = live.get(id);
      live.delete(id);
      await l?.sbx.kill().catch(() => undefined);
    },
  };
}

/** A live view address the console may frame: https on E2B's own sandbox hosts (`<port>-<sandbox id>.e2b.app`). */
export function isLiveViewUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && /^\d{2,5}-[a-z0-9]{8,40}\.e2b\.(app|dev)$/.test(u.hostname);
  } catch {
    return false;
  }
}
