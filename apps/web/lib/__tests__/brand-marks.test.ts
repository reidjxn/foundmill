/**
 * Founder rule (2026-10-09): the "FM" monogram is exclusively the browser favicon / app icon. In the product the brand is
 * the Wordmark. `LogoMark` stays in Dugout (and Storybook) because the favicon art derives from it, so this guard fails
 * if any product or design-system component starts rendering it again.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOT = join(WEB, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "e2e" || name === "test-results") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx|mdx)$/.test(name) && !/\.(test|stories)\.(ts|tsx|mdx)$/.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("the FM monogram is favicon-only", () => {
  const scanned = [join(WEB, "app"), join(WEB, "components"), join(WEB, "lib"), join(ROOT, "packages", "dugout", "src", "components")]
    .filter((d) => existsSync(d))
    .flatMap(sourceFiles);

  it("scans the product and Dugout component sources", () => {
    expect(scanned.length).toBeGreaterThan(100);
  });

  it("no product or Dugout component renders or imports LogoMark (only its own file and the barrel export it)", () => {
    const allowed = new Set([
      join(ROOT, "packages", "dugout", "src", "components", "foundation", "LogoMark.tsx"),
      join(ROOT, "packages", "dugout", "src", "components", "foundation.ts"),
    ]);
    const offenders = scanned.filter((f) => !allowed.has(f) && /\bLogoMark\b/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("keeps the favicon and app icon files the monogram is for", () => {
    for (const f of ["app/icon.svg", "app/apple-icon.png"]) expect(existsSync(join(WEB, f))).toBe(true);
  });
});
