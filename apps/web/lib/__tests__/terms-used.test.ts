/**
 * Every definition in TERMS is used on a screen (WP-10 T4): `<Term id="…">`, an `InfoTip`/`term` prop, a column's
 * `meta: { term }`, `useTerm("…")`, `termId: "…"` or `TERMS.…`. The palette's Help group lists every id, so it proves
 * nothing and is not counted. A definition nobody reaches is dead copy: use it where a first-timer meets the word, or
 * remove it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TERM_IDS } from "@foundmill/shared/terms";

const ROOT = join(process.cwd(), "../.."); // vitest runs from apps/web
const DIRS = ["apps/web", "packages/modules/src", "packages/widgets/src", "packages/dugout/src"];
const SKIP = /node_modules|\.next|__tests__|\.test\.|\.stories\.|\.testing\./;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Defined and found by the palette's Help group and the Composer, but not yet shown on a screen. Each one is debt:
 * use it where a first-timer meets the word, or remove it. The test fails when one of these gets used (take it off the
 * list) and when a new id has no use.
 */
const NOT_ON_A_SCREEN_YET = ["conversion", "pipeline", "contacts", "sku", "product_lead", "policy", "team_budget"];

describe("terms in use (WP-10 T4)", () => {
  it("every TERMS id is used on a screen (concept attributes are read by key and are exempt)", () => {
    const text = DIRS.flatMap((d) => sources(join(ROOT, d))).map((f) => readFileSync(f, "utf8")).join("\n");
    const used = (id: string) => new RegExp(`(?:\\bid=|\\bterm=|\\bterm:\\s*|termId:\\s*|metricId:\\s*|useTerm\\(|\\bTERMS\\.|\\bterm\\b[^\\n]{0,20}?)\\{?["'\`]?${id}["'\`]|TERMS\\.${id}\\b`).test(text);
    const unused = TERM_IDS.filter((id) => !id.startsWith("attr_") && !used(id));
    expect(unused).toEqual(NOT_ON_A_SCREEN_YET);
  });
});
