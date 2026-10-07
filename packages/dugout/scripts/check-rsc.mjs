/**
 * Loads the @foundmill/dugout barrel the way a React Server Component bundle would: the `react-server` resolve
 * condition (so `react` is the server build with no useState/createContext), and every module that opens with
 * "use client" replaced by a stub (a client reference boundary). If a module without the directive touches a hook,
 * a client-only library or the DOM at import time, the load fails here instead of in `next build`.
 *
 *   node scripts/check-rsc.mjs
 */
import { createServer } from "vite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Externalised packages (react, lucide, radix…) are loaded by Node itself, so the condition has to be Node's flag,
// not only Vite's resolver. Re-run under `--conditions=react-server` once.
if (!process.execArgv.some((a) => a.includes("react-server")) && !process.env.DUGOUT_RSC_CHILD) {
  const r = spawnSync(process.execPath, ["--conditions=react-server", fileURLToPath(import.meta.url)], { stdio: "inherit", env: { ...process.env, DUGOUT_RSC_CHILD: "1" } });
  process.exit(r.status ?? 1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The directive may follow comments and other prologue directives ("use strict"), as in lucide's ESM build.
const DIRECTIVE = /^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/|["']use strict["'];?))*\s*["']use client["']/;

const clientModules = new Set();
const clientLibraryModules = new Set();

/** Export names of a plain-JS module (esbuild output: types are gone, `export { a as b }` and declarations remain). */
function exportedNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] ?? as[0]).trim());
    }
  }
  if (/\bexport\s+default\b/.test(code)) names.add("default");
  return names;
}

/** Replace "use client" modules with stubs that export the same names (after esbuild has produced plain JS). */
const stubClientModules = {
  name: "dugout-rsc-stub",
  enforce: "post",
  async transform(code, id) {
    if (!DIRECTIVE.test(code)) return null;
    if (id.startsWith(root + "/src/")) clientModules.add(path.relative(root, id));
    else clientLibraryModules.add(id.replace(/^.*\/node_modules\//, ""));
    const names = exportedNames(code);
    const lines = [...names].filter((n) => n !== "default").map((n) => `export const ${n} = Object.assign(function ClientReference_${n}() { throw new Error("client reference ${n}"); }, { $$typeof: Symbol.for("react.client.reference"), $$id: ${JSON.stringify(`${path.relative(root, id)}#${n}`)} });`);
    if (names.has("default")) lines.push("export default null;");
    return { code: lines.join("\n"), map: null };
  },
};

// `react` under the react-server condition is a CommonJS build without the client hooks. Node and Vite refuse a named
// import of a missing CJS export at link time, while webpack/Turbopack hand back `undefined` (and fail only when it
// is called). Mirror the bundlers: a virtual module exports every name of the server build plus `undefined` for the
// client-only API, so an import-time `createContext()` in a server module still throws here.
const CLIENT_ONLY_REACT = ["useState", "useEffect", "useLayoutEffect", "useInsertionEffect", "useRef", "useContext", "createContext", "useReducer", "useSyncExternalStore", "useImperativeHandle", "useTransition", "useDeferredValue", "useOptimistic", "useActionState", "useEffectEvent", "Component", "PureComponent", "createRef", "flushSync", "unstable_useCacheRefresh"];
const serverReact = await import("react");
const reactNames = [...new Set([...Object.keys(serverReact), ...Object.keys(serverReact.default ?? {}), ...CLIENT_ONLY_REACT])].filter((n) => n !== "default" && /^[A-Za-z_$][\w$]*$/.test(n));
const shimDir = mkdtempSync(path.join(os.tmpdir(), "dugout-rsc-"));
const reactShimPath = path.join(shimDir, "react-server-shim.mjs");
writeFileSync(
  reactShimPath,
  [
    'import { createRequire } from "node:module";',
    `const r = createRequire(${JSON.stringify(path.join(root, "package.json"))})("react");`,
    "export default r;",
    ...reactNames.map((n) => `export const ${n} = r.${n};`),
  ].join("\n"),
);

const server = await createServer({
  root,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null },
  resolve: { conditions: ["react-server", "node", "import", "module", "default"], alias: [{ find: /^react$/, replacement: reactShimPath }] },
  // Libraries whose modules declare "use client" themselves must go through the stub transform, as in Next's bundle.
  ssr: { noExternal: ["@foundmill/shared", "@foundmill/config", "lucide-react", "react-markdown"], resolve: { externalConditions: ["react-server", "node"] } },
  plugins: [stubClientModules],
  esbuild: { jsx: "automatic" },
});

try {
  const react = serverReact;
  if (typeof react.useState === "function" || typeof react.createContext === "function") {
    throw new Error("react resolved to the client build; the react-server condition did not apply");
  }
  const dugout = await server.ssrLoadModule("/src/index.ts");

  const problems = [];
  const expectServerSafe = ["formatMoney", "formatDate", "cn", "kitOnPrimary", "ratingBandLabel", "DUGOUT_VERSION", "snapSpan", "buildReplaySchedule", "LINE_LABELS", "STAGE_LABELS"];
  for (const name of expectServerSafe) {
    const v = dugout[name];
    if (v === undefined) problems.push(`${name} is not exported from the barrel`);
    else if (v && v.$$typeof === Symbol.for("react.client.reference")) problems.push(`${name} became a client reference (its file carries "use client")`);
  }
  // A pure component renders on the server: Crest and StatusPill produce elements without hooks.
  const { createElement } = react;
  const el = createElement(dugout.StatusPill, { tone: "good" }, "Healthy");
  if (!el || typeof el !== "object") problems.push("StatusPill did not produce an element");
  const svg = dugout.generateCrest({ seed: "northwind", monogram: "NW", kitPrimary: "#2B6CB0", kitSecondary: "#FFFFFF", size: 32 });
  if (typeof svg !== "string" || !svg.includes("<svg")) problems.push("generateCrest did not return SVG markup");

  const exported = Object.keys(dugout).length;
  console.log(`barrel loaded under react-server: ${exported} exports, ${clientModules.size} dugout client modules stubbed, ${clientLibraryModules.size} library modules with their own "use client"`);
  if (problems.length) {
    console.error(problems.map((p) => ` - ${p}`).join("\n"));
    process.exitCode = 1;
  } else console.log("ok: server-safe exports are real values; no server module touched a client API at import time");
} catch (err) {
  console.error("FAILED:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
} finally {
  await server.close();
  rmSync(shimDir, { recursive: true, force: true });
}
