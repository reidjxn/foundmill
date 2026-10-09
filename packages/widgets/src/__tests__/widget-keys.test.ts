import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** registerWidget replaces a re-registered key (hot reload); this keeps two different widgets from sharing one. */
describe("widget keys", () => {
  it("every widget definition in src/widgets has a unique key", () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "widgets");
    const keys: string[] = [];
    for (const file of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const m of source.matchAll(/registerWidget<[^>]*>\(\{\s*key:\s*"([^"]+)"/g)) keys.push(m[1]!);
      for (const m of source.matchAll(/registerWidget\(\{\s*key:\s*"([^"]+)"/g)) keys.push(m[1]!);
    }
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
});
