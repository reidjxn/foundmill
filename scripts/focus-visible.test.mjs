// Run: node --test scripts/focus-visible.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasInvisibleFocusOutline, scanSource } from "./focus-visible.mjs";

describe("hasInvisibleFocusOutline", () => {
  it("flags outline-none with a focus outline width or color (the audit's Inbox row)", () => {
    assert.equal(hasInvisibleFocusOutline("flex w-full text-left outline-none hover:bg-white/4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-link"), true);
    assert.equal(hasInvisibleFocusOutline("rounded-chip outline-none focus-visible:outline-2 focus-visible:outline-link"), true);
    assert.equal(hasInvisibleFocusOutline("outline-hidden focus:outline-2"), true);
  });

  it("allows a deliberate no-outline, a restored style, and lists without outline-none", () => {
    assert.equal(hasInvisibleFocusOutline("border-0 focus:outline-none focus-visible:outline-none"), false);
    assert.equal(hasInvisibleFocusOutline("outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-link"), false);
    assert.equal(hasInvisibleFocusOutline("focus-visible:outline-2 focus-visible:outline-link"), false);
    assert.equal(hasInvisibleFocusOutline("outline-none focus-visible:focus-ring"), false);
    assert.equal(hasInvisibleFocusOutline("outline-none focus-visible:shadow-ring"), false);
  });
});

describe("scanSource", () => {
  it("reports the line of each offending string, also inside cn() calls", () => {
    const source = [
      'const a = "outline-none hover:bg-x";',
      "const b = cn(",
      '  "flex outline-none",',
      '  active && "focus-visible:outline-2 focus-visible:outline-link",',
      ");",
      'const c = "rounded outline-none focus-visible:outline-2 focus-visible:outline-link";',
    ].join("\n");
    // Strings on separate lines are separate class lists; the one that holds both is reported.
    assert.deepEqual(scanSource(source), [6]);
    assert.deepEqual(scanSource('const d = cn("outline-none", on && "focus-visible:outline-2 focus-visible:outline-link");'), [1]);
  });
});
