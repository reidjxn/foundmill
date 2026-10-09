import { describe, expect, it } from "vitest";
import { JsonElementScanner, type ScannedElement, arrayAtPath, elementPathKeys, getAtPath } from "./stream-json";

/** Feed `text` in the given chunk sizes (cycled) and collect every reported element. */
function scan(text: string, path: string, sizes: number[] = [text.length]): { elements: ScannedElement[]; scanner: JsonElementScanner } {
  const elements: ScannedElement[] = [];
  const scanner = new JsonElementScanner({ path, onElement: (e) => elements.push(e) });
  let at = 0;
  let i = 0;
  while (at < text.length) {
    const size = Math.max(1, sizes[i++ % sizes.length] as number);
    scanner.feed(text.slice(at, at + size));
    at += size;
  }
  return { elements, scanner };
}

/** Deterministic pseudo-random chunk sizes in [1, max]. */
function randomSizes(seed: number, count: number, max: number): number[] {
  let x = seed;
  return Array.from({ length: count }, () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return 1 + (x % max);
  });
}

const tricky = {
  title: "Set [of] {things}",
  concepts: [
    { id: "a", name: 'Quote "inside" and a backslash \\ here', tags: ["[", "]", "{", "}", ","], nested: { deep: [{ x: 1 }, { y: [2, 3, { z: "}]" }] }] } },
    { id: "b", name: "Unicode é中 🚀 and escapes \n\t\"", n: -12.5e3, ok: true, none: null },
    { id: "c", name: "", empty: {}, list: [] },
  ],
  after: { concepts: ["not the target"] },
};

describe("JsonElementScanner", () => {
  it("reports each element of the target array with its exact text, in order", () => {
    const text = JSON.stringify(tricky, null, 2);
    const { elements, scanner } = scan(text, "concepts");
    expect(elements.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(elements.map((e) => JSON.parse(e.raw))).toEqual(tricky.concepts);
    for (const e of elements) expect(text.slice(e.start, e.end)).toBe(e.raw);
    expect(scanner.done).toBe(true);
    expect(scanner.completed).toBe(3);
  });

  it("gives the same elements whatever the chunk boundaries (single characters, random splits)", () => {
    const text = JSON.stringify(tricky);
    const expected = tricky.concepts;
    expect(scan(text, "concepts", [1]).elements.map((e) => JSON.parse(e.raw))).toEqual(expected);
    for (let seed = 1; seed <= 40; seed++) {
      const { elements } = scan(text, "concepts", randomSizes(seed, 200, 17));
      expect(elements.map((e) => JSON.parse(e.raw)), `seed ${seed}`).toEqual(expected);
    }
  });

  it("reports an element as soon as its closing character arrives, not later", () => {
    const text = '{"concepts":[{"a":1},{"b":"x}"}],"tail":true}';
    const scanner = new JsonElementScanner({ path: "concepts" });
    const firstEnd = text.indexOf("},") + 1;
    expect(scanner.feed(text.slice(0, firstEnd - 1))).toEqual([]);
    expect(scanner.writingIndex).toBe(0);
    const got = scanner.feed(text.slice(firstEnd - 1, firstEnd));
    expect(got.map((e) => e.raw)).toEqual(['{"a":1}']);
    expect(scanner.writingIndex).toBeNull();
    const rest = scanner.feed(text.slice(firstEnd));
    expect(rest.map((e) => JSON.parse(e.raw))).toEqual([{ b: "x}" }]);
  });

  it("handles primitive elements, which end at a comma or the closing bracket", () => {
    const text = '{"xs": [1, -2.5e2, "s,]", true, null, false]}';
    const { elements } = scan(text, "xs", [1, 2, 3]);
    expect(elements.map((e) => JSON.parse(e.raw))).toEqual([1, -250, "s,]", true, null, false]);
  });

  it("follows dotted paths and ignores arrays with the same key elsewhere", () => {
    const doc = { concepts: ["root"], roadmap: { items: [{ t: 1 }, { t: 2 }], concepts: ["nested"] } };
    const text = JSON.stringify(doc);
    expect(scan(text, "roadmap.items").elements.map((e) => JSON.parse(e.raw))).toEqual([{ t: 1 }, { t: 2 }]);
    expect(scan(text, "concepts").elements.map((e) => JSON.parse(e.raw))).toEqual(["root"]);
    expect(scan(JSON.stringify([{ a: 1 }, { b: 2 }]), "").elements.map((e) => JSON.parse(e.raw))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("matches keys by their decoded value (escaped keys)", () => {
    const text = '{"con\\u0063epts":[{"a":1}]}';
    expect(scan(text, "concepts").elements).toHaveLength(1);
  });

  it("skips a preamble or code fence before the root value and anything after it", () => {
    const text = 'Here you go:\n```json\n{"concepts":[{"a":1},{"a":2}]}\n```\n[{"ignored":true}]';
    const { elements, scanner } = scan(text, "concepts", [3]);
    expect(elements.map((e) => JSON.parse(e.raw))).toEqual([{ a: 1 }, { a: 2 }]);
    expect(scanner.rootText()).toBe('{"concepts":[{"a":1},{"a":2}]}');
  });

  it("reports nothing for a document without the target array", () => {
    expect(scan('{"other":[1,2,3]}', "concepts").elements).toEqual([]);
  });

  it("snapshots the document so far with only completed members", () => {
    const text = '{"vision":{"statement":"We help","why_now":"Because"},"concepts":[{"name":"One","tags":["a"]},{"name":"Tw';
    const scanner = new JsonElementScanner({ path: "concepts" });
    expect(scanner.snapshot()).toBeUndefined();
    scanner.feed(text);
    expect(scanner.snapshot()).toEqual({ vision: { statement: "We help", why_now: "Because" }, concepts: [{ name: "One", tags: ["a"] }, {}] });
    scanner.feed('o","n":12');
    expect(scanner.snapshot()).toEqual({ vision: { statement: "We help", why_now: "Because" }, concepts: [{ name: "One", tags: ["a"] }, { name: "Two" }] });
    scanner.feed(",");
    expect(scanner.snapshot()).toEqual({ vision: { statement: "We help", why_now: "Because" }, concepts: [{ name: "One", tags: ["a"] }, { name: "Two", n: 12 }] });
    scanner.feed('"m":1}],"done":tr');
    expect(scanner.snapshot()).toEqual({ vision: { statement: "We help", why_now: "Because" }, concepts: [{ name: "One", tags: ["a"] }, { name: "Two", n: 12, m: 1 }] });
    scanner.feed("ue}");
    expect(scanner.snapshot()).toEqual({ vision: { statement: "We help", why_now: "Because" }, concepts: [{ name: "One", tags: ["a"] }, { name: "Two", n: 12, m: 1 }], done: true });
  });

  it("snapshots stay parseable at every cut of a realistic document", () => {
    const text = JSON.stringify(tricky, null, 1);
    const scanner = new JsonElementScanner({ path: "concepts" });
    for (const ch of text) {
      scanner.feed(ch);
      const snap = scanner.snapshot();
      if (scanner.text.trimStart().startsWith("{")) expect(snap).toBeTypeOf("object");
    }
    expect(scanner.snapshot()).toEqual(tricky);
  });

  it("reports a malformed element anyway (the caller's JSON.parse rejects it)", () => {
    const { elements } = scan('{"concepts":[{"a":01x},{"b":2}]}', "concepts");
    expect(elements).toHaveLength(2);
    expect(() => JSON.parse(elements[0]!.raw)).toThrow();
    expect(JSON.parse(elements[1]!.raw)).toEqual({ b: 2 });
  });
});

describe("path helpers", () => {
  it("splits, reads and creates arrays at dotted paths", () => {
    expect(elementPathKeys("")).toEqual([]);
    expect(elementPathKeys("roadmap.items")).toEqual(["roadmap", "items"]);
    const doc: Record<string, unknown> = { a: { b: [1] } };
    expect(getAtPath(doc, "a.b")).toEqual([1]);
    expect(getAtPath(doc, "a.c")).toBeUndefined();
    expect(arrayAtPath(doc, "a.b")).toEqual([1]);
    expect(arrayAtPath(doc, "x.y")).toBeUndefined();
    const created = arrayAtPath(doc, "x.y", true);
    expect(created).toEqual([]);
    expect(doc.x).toEqual({ y: [] });
    expect(arrayAtPath([1, 2], "")).toEqual([1, 2]);
  });
});
