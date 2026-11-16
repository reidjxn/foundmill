// Run: node --test scripts/design-tokens.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { judge, scanSource } from "./design-tokens.mjs";

describe("scanSource", () => {
  it("finds hex colors and arbitrary Tailwind lengths, with their lines", () => {
    const hits = scanSource(['const a = "#1b4fd8";', 'const b = "text-[17px] max-w-[85vw] w-[42%]";', 'const c = "#FFF";'].join("\n"));
    assert.deepEqual(
      hits.map((h) => [h.line, h.kind, h.text]),
      [
        [1, "hex", "#1b4fd8"],
        [2, "arbitrary", "-[17px]"],
        [2, "arbitrary", "-[85vw]"],
        [2, "arbitrary", "-[42%]"],
        [3, "hex", "#FFF"],
      ],
    );
  });

  it("leaves anchors, ids, entities and token-based classes alone", () => {
    const src = ['href="#add-skill"', 'href="#main"', "&#039;", 'className="h-control-md text-(--fs-reading) w-(--phone-menu-max)"', "issue #12"].join("\n");
    assert.deepEqual(scanSource(src), []);
  });
});

describe("judge", () => {
  it("fails a new file with a leak and a listed file that grows; notes one that shrank", () => {
    const counts = new Map([
      ["a.tsx", 1],
      ["b.tsx", 3],
      ["c.tsx", 1],
    ]);
    const allow = { "b.tsx": { count: 2 }, "c.tsx": { count: 2 }, "gone.tsx": { count: 1 } };
    const { failures, shrunk } = judge(counts, allow);
    assert.equal(failures.length, 2);
    assert.match(failures[0], /^a\.tsx: 1 hex or arbitrary value, 0 allowed/);
    assert.match(failures[1], /^b\.tsx: 3/);
    assert.equal(shrunk.length, 2);
  });
});
