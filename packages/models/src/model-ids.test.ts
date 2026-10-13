/**
 * CLAUDE.md "Model ids only in packages/models/src/routing.ts" as a check (audit GPC-18): no product source file outside
 * routing.ts spells a Claude model id. Fixtures, stories and prompts import the ids from routing.ts; tests may assert
 * them.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LISTED_UNROUTED_MODELS, MODELS } from "./routing";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const ROUTING = join("packages", "models", "src", "routing.ts");
const ROOTS = ["apps", "packages", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "storybook-static", "coverage", ".turbo", "test-results", "playwright-report", ".pglite", "__tests__", "e2e", "testing"]);
const CODE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** A model id as Anthropic spells it: `claude-<family>-<version>`. */
const MODEL_ID = /\bclaude-(?:opus|sonnet|haiku)-\d[\w.-]*/g;

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) yield* sourceFiles(path);
    else if (CODE.test(name) && !TEST.test(name) && !name.endsWith(".d.ts")) yield path;
  }
}

function modelIdHits(root: string): string[] {
  const hits: string[] = [];
  for (const top of ROOTS) {
    for (const file of sourceFiles(join(root, top))) {
      const rel = relative(root, file);
      if (rel === ROUTING) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(MODEL_ID)) hits.push(`${rel.split(sep).join("/")}:${i + 1}: ${m[0]}`);
        });
    }
  }
  return hits;
}

describe("model ids live only in routing.ts", () => {
  it("routing.ts holds every id a fixture lists", () => {
    for (const id of [...Object.values(MODELS), ...LISTED_UNROUTED_MODELS.map((m) => m.id)]) expect(id).toMatch(MODEL_ID);
  });

  it("no product source file outside routing.ts spells a model id", () => {
    expect(modelIdHits(REPO_ROOT)).toEqual([]);
  });
});
