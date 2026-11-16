/**
 * Today's bundle (WP-10 T13, audit A2-15). The `@foundmill/widgets` barrel ends by registering every widget, so one
 * import of it from anything Today reaches pulls all of them into Today's first load. Measured on a production build
 * (Nov 16, 2026): the /b/[bid]/today client chunks were 477 KB gzipped with the barrel and 308 KB without it. This walks
 * Today's static imports inside the repo and fails on the barrel (deep paths such as `@foundmill/widgets/data` are fine).
 * Type-only imports are erased at build time and are skipped.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = resolve(__dirname, "../..");
const REPO = resolve(WEB, "../..");
const ENTRY = join(WEB, "components/today/TodayScreen.tsx");
const BARRELS = new Set(["@foundmill/widgets"]);
const EXT = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function file(base: string): string | null {
  for (const e of EXT) if (existsSync(base + e) && !base.endsWith("/") && (e || /\.[jt]sx?$/.test(base))) return base + e;
  return null;
}

/** A specifier to a source file in the repo, or null for a package outside it. */
function resolveSpec(spec: string, from: string): string | null {
  if (spec.startsWith(".")) return file(resolve(dirname(from), spec));
  if (spec.startsWith("@/")) return file(join(WEB, spec.slice(2)));
  const m = /^@foundmill\/([^/]+)(?:\/(.+))?$/.exec(spec);
  if (!m) return null;
  const pkgDir = [join(REPO, "packages", m[1]!), join(REPO, "apps", m[1]!)].find((d) => existsSync(join(d, "package.json")));
  if (!pkgDir) return null;
  const exportsMap = (JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { exports?: Record<string, string> }).exports ?? {};
  const key = m[2] ? `./${m[2]}` : ".";
  const target = exportsMap[key];
  if (target) return file(join(pkgDir, target));
  return file(join(pkgDir, "src", m[2] ?? "index"));
}

function barrelImports(entry: string): string[] {
  const seen = new Set<string>();
  const hits: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)) {
      if (m[2]) continue;
      const spec = (m[3] ?? m[4])!;
      if (BARRELS.has(spec)) hits.push(`${f.slice(REPO.length + 1)} imports ${spec}`);
      const next = resolveSpec(spec, f);
      if (next && !next.includes("node_modules")) queue.push(next);
    }
  }
  return hits;
}

describe("Today's bundle", () => {
  it("nothing Today imports reaches the widgets barrel", () => {
    expect(barrelImports(ENTRY)).toEqual([]);
  });
  it("the walk does find the barrel when it is imported", () => {
    expect(barrelImports(join(WEB, "components/home/HomeScreen.tsx")).length).toBeGreaterThan(0);
  });
});
