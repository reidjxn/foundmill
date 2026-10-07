/** ProseMirror JSON ⇄ Yjs conversion (y-prosemirror layout) and the top-level reconcile used for agent edits. */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { docToPmDoc, fragmentToPmDoc, InvalidProseMirrorJsonError, parsePmDoc, pmDocToYDoc, pmEqual, reconcileFragment, type PmNode } from "../prosemirror";

const richDoc: PmNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Problem" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Plain " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        { type: "text", text: " and " },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.test", target: null } }, { type: "italic" }] },
      ],
    },
    { type: "paragraph" },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }] }] }] },
    { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const x = 1;" }] },
  ],
};

describe("ProseMirror JSON ⇄ Yjs", () => {
  it("round-trips a rich document exactly (nodes, attrs, marks with attrs, empty blocks, inline leaves)", () => {
    const ydoc = pmDocToYDoc(richDoc);
    expect(docToPmDoc(ydoc)).toEqual(richDoc);
  });

  it("uses y-prosemirror's layout: XmlElement per node, one XmlText per text run, marks as formatting attributes", () => {
    const ydoc = pmDocToYDoc(richDoc);
    const fragment = ydoc.getXmlFragment("default");
    const paragraph = fragment.get(1) as Y.XmlElement;
    expect(paragraph.nodeName).toBe("paragraph");
    expect(paragraph.length).toBe(1);
    const text = paragraph.get(0) as Y.XmlText;
    expect(text).toBeInstanceOf(Y.XmlText);
    expect(text.toDelta()).toEqual([
      { insert: "Plain " },
      { insert: "bold", attributes: { bold: {} } },
      { insert: " and " },
      { insert: "link", attributes: { link: { href: "https://example.test", target: null }, italic: {} } },
    ]);
    const heading = fragment.get(0) as Y.XmlElement;
    expect(heading.getAttribute("level")).toBe(2);
  });

  it("the Yjs state produced here merges into another Y.Doc and decodes identically (what a provider receives)", () => {
    const a = pmDocToYDoc(richDoc);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(docToPmDoc(b)).toEqual(richDoc);
  });

  it("an empty document is an empty fragment and decodes to the default content", () => {
    const ydoc = pmDocToYDoc({ type: "doc", content: [] });
    expect(ydoc.getXmlFragment("default").length).toBe(0);
    expect(docToPmDoc(ydoc)).toEqual({ type: "doc", content: [] });
  });

  it("drops null attributes on encode (y-prosemirror does) and never emits empty attrs on decode", () => {
    const ydoc = pmDocToYDoc({ type: "doc", content: [{ type: "image", attrs: { src: "x.png", alt: null, title: null } }, { type: "paragraph", attrs: {} }] });
    expect(docToPmDoc(ydoc)).toEqual({ type: "doc", content: [{ type: "image", attrs: { src: "x.png" } }, { type: "paragraph" }] });
  });

  it("parsePmDoc rejects shapes ProseMirror cannot read", () => {
    expect(() => parsePmDoc(null)).toThrow(InvalidProseMirrorJsonError);
    expect(() => parsePmDoc({ type: "paragraph" })).toThrow(/root node must be "doc"/);
    expect(() => parsePmDoc({ type: "doc", content: [{ type: "text" }] })).toThrow(/text node has no text/);
    expect(() => parsePmDoc({ type: "doc", content: [{ attrs: {} }] })).toThrow(/has no type/);
    expect(() => parsePmDoc({ type: "doc", content: [{ type: "paragraph", content: "nope" }] })).toThrow(/content must be an array/);
    expect(() => parsePmDoc({ type: "doc", content: [{ type: "text", text: "x", marks: [{}] }] })).toThrow(/mark has no type/);
    expect(parsePmDoc(richDoc)).toEqual(richDoc);
  });
});

describe("reconcileFragment", () => {
  it("is a no-op when the document already matches", () => {
    const ydoc = pmDocToYDoc(richDoc);
    let result;
    ydoc.transact(() => {
      result = reconcileFragment(ydoc.getXmlFragment("default"), richDoc);
    });
    expect(result).toEqual({ changed: 0, kept: 5 });
  });

  it("updates a changed block in place (text diff) and keeps every block's Yjs identity", () => {
    const ydoc = pmDocToYDoc(richDoc);
    const fragment = ydoc.getXmlFragment("default");
    const before = fragment.toArray();
    const next = structuredClone(richDoc);
    next.content![1] = { type: "paragraph", content: [{ type: "text", text: "Rewritten by the agent" }] };
    next.content!.push({ type: "paragraph", content: [{ type: "text", text: "Appended" }] });
    let result;
    ydoc.transact(() => {
      result = reconcileFragment(fragment, next);
    });
    expect(result).toEqual({ changed: 2, kept: 4 }); // one text edit inside block 1, one insert for the tail
    expect(fragmentToPmDoc(fragment)).toEqual(next);
    expect(fragment.toArray().slice(0, 5)).toEqual(before);
  });

  it("changes attributes in place and diffs text with marks at character granularity", () => {
    const ydoc = pmDocToYDoc(richDoc);
    const fragment = ydoc.getXmlFragment("default");
    const next = structuredClone(richDoc);
    next.content![0]!.attrs = { level: 3 };
    // "Plain " → "Plainer " and the bold word gains a mark; everything after is untouched.
    next.content![1]!.content![0] = { type: "text", text: "Plainer " };
    next.content![1]!.content![1] = { type: "text", text: "bold", marks: [{ type: "bold" }, { type: "underline" }] };
    let result;
    ydoc.transact(() => {
      result = reconcileFragment(fragment, next);
    });
    expect(result).toEqual({ changed: 2, kept: 3 });
    expect(fragmentToPmDoc(fragment)).toEqual(next);
    const paragraphText = (fragment.get(1) as Y.XmlElement).get(0) as Y.XmlText;
    expect(paragraphText.toDelta()).toEqual([
      { insert: "Plainer " },
      { insert: "bold", attributes: { bold: {}, underline: {} } },
      { insert: " and " },
      { insert: "link", attributes: { link: { href: "https://example.test", target: null }, italic: {} } },
    ]);
  });

  it("a human typing in the same paragraph an agent rewrites keeps both changes (character-level CRDT merge)", () => {
    const server = pmDocToYDoc(richDoc);
    const human = new Y.Doc();
    Y.applyUpdate(human, Y.encodeStateAsUpdate(server));
    const humanRun = (human.getXmlFragment("default").get(1) as Y.XmlElement).get(0) as Y.XmlText;
    humanRun.insert(humanRun.length, " — human addendum");
    const next = structuredClone(richDoc);
    next.content![1]!.content![0] = { type: "text", text: "Agent-edited " };
    server.transact(() => reconcileFragment(server.getXmlFragment("default"), next));
    Y.applyUpdate(server, Y.encodeStateAsUpdate(human, Y.encodeStateVector(server)));
    Y.applyUpdate(human, Y.encodeStateAsUpdate(server, Y.encodeStateVector(human)));
    const text = JSON.stringify(docToPmDoc(server));
    expect(docToPmDoc(human)).toEqual(docToPmDoc(server));
    expect(text).toContain("Agent-edited ");
    expect(text).toContain(" — human addendum");
    expect(text).not.toContain("Plain ");
  });

  it("keeps blocks that moved (LCS over top-level items), so a reorder does not rewrite everything", () => {
    const ydoc = pmDocToYDoc(richDoc);
    const fragment = ydoc.getXmlFragment("default");
    const list = fragment.get(3);
    const next = structuredClone(richDoc);
    const [heading, ...rest] = next.content!;
    next.content = [...rest, heading!]; // heading moves to the end
    let result;
    ydoc.transact(() => {
      result = reconcileFragment(fragment, next);
    });
    expect(fragmentToPmDoc(fragment)).toEqual(next);
    expect(result).toEqual({ changed: 2, kept: 4 });
    expect(fragment.get(2)).toBe(list);
  });

  it("a concurrent human edit inside an untouched block survives an agent reconcile (CRDT merge)", () => {
    const server = pmDocToYDoc(richDoc);
    const human = new Y.Doc();
    Y.applyUpdate(human, Y.encodeStateAsUpdate(server));
    // Human types into the list item while the agent rewrites the first paragraph.
    const humanText = ((human.getXmlFragment("default").get(3) as Y.XmlElement).get(0) as Y.XmlElement).get(0) as Y.XmlElement;
    (humanText.get(0) as Y.XmlText).insert(3, " (human)");
    const next = structuredClone(richDoc);
    next.content![1] = { type: "paragraph", content: [{ type: "text", text: "Agent paragraph" }] };
    server.transact(() => reconcileFragment(server.getXmlFragment("default"), next));
    // Exchange updates both ways.
    Y.applyUpdate(server, Y.encodeStateAsUpdate(human, Y.encodeStateVector(server)));
    Y.applyUpdate(human, Y.encodeStateAsUpdate(server, Y.encodeStateVector(human)));
    const merged = docToPmDoc(server);
    expect(merged).toEqual(docToPmDoc(human));
    expect(JSON.stringify(merged)).toContain("Agent paragraph");
    expect(JSON.stringify(merged)).toContain("one (human)");
  });

  it("pmEqual ignores undefined-valued keys and compares deeply", () => {
    expect(pmEqual({ type: "paragraph", attrs: undefined }, { type: "paragraph" })).toBe(true);
    expect(pmEqual([{ a: [1, 2] }], [{ a: [1, 2] }])).toBe(true);
    expect(pmEqual([{ a: [1, 2] }], [{ a: [1, 3] }])).toBe(false);
  });
});
