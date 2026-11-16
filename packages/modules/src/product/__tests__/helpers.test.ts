/** Pure helpers: ProseMirror text round trip, computed roadmap status, board moves, timeline scale, hunk progress, impact lines, source coverage. */
import { describe, expect, it } from "vitest";
import { pmExcerpt, pmTitle, pmToText, pmWordCount, textToPm } from "../prosemirror";
import { computeRoadmapStatus, taskSummary } from "../roadmap-status";
import { adjacentHorizon, barSpan, groupByHorizon, indexDependencies, isMove, moveInput, timelineScale } from "../roadmap/board-logic";
import { decisionProgress, hunkSides, impactLines, isSettled } from "../changes/hunks";
import { coverageBySection, isWebUri, linkedBlocks, topicCounts } from "../sources/kinds";
import { validateSourceDraft, sourceInput } from "../sources/AddSourceDialog";
import { upsertInput, draftFrom, validateDraft } from "../roadmap/ItemDialog";
import { compareSections, groupBySection } from "../shared";
import { signoffStatusWord, signoffSummaryLine } from "../signoff";
import type { SpecBlockRow } from "../types";
import { blocks, doc, proposalAnnual, roadmap, sources, BLOCK, ITEM } from "./fixtures";

describe("prosemirror text subset", () => {
  it("round-trips headings, lists, quotes and code through text", () => {
    const text = "# Title\n\nA paragraph\nwith a break\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```\ncode\n```";
    expect(pmToText(textToPm(text))).toBe(text);
  });
  it("reads titles, excerpts and word counts", () => {
    const d = doc("# Invoices go unpaid", "Freelancers chase late invoices by hand.");
    expect(pmTitle(d)).toBe("Invoices go unpaid");
    expect(pmTitle({ type: "doc", content: [] }, "Section")).toBe("Section");
    expect(pmExcerpt(d, 20)).toBe("Invoices go unpaid…");
    expect(pmWordCount(d)).toBe(10);
    expect(pmToText(null)).toBe("");
  });
});

describe("roadmap status (AC-11.5.4)", () => {
  const today = new Date("2026-10-07T12:00:00Z");
  it("is Done only when the API says done, never from tasks alone", () => {
    expect(computeRoadmapStatus({ status: "done", tasks: [], targetEnd: null }, today).key).toBe("done");
    expect(computeRoadmapStatus({ status: "planned", tasks: [{ id: "t", title: "t", status: "done", progress: 1 }], targetEnd: "2027-01-01" }, today).key).toBe("awaiting_acceptance");
  });
  it("derives blocked, at risk, in progress and planned", () => {
    expect(computeRoadmapStatus({ status: "planned", tasks: [{ id: "t", title: "t", status: "blocked", progress: 0 }], targetEnd: null }, today).key).toBe("blocked");
    expect(computeRoadmapStatus({ status: "planned", tasks: [], targetEnd: "2026-09-01" }, today).key).toBe("at_risk");
    expect(computeRoadmapStatus({ status: "planned", tasks: [{ id: "t", title: "t", status: "running", progress: 0.5 }], targetEnd: "2027-01-01" }, today).key).toBe("in_progress");
    expect(computeRoadmapStatus({ status: "planned", tasks: [], targetEnd: null }, today).key).toBe("planned");
    expect(taskSummary(roadmap.items[0]!)).toEqual({ done: 1, total: 2, progress: 0.7 });
  });
});

describe("board helpers", () => {
  it("groups by horizon in position order; a move sends only the item, the horizon and its place in the column", () => {
    const cols = groupByHorizon(roadmap.items);
    expect(cols.now.map((i) => i.id)).toEqual([ITEM.billing, ITEM.mobile]);
    expect(cols.next.map((i) => i.id)).toEqual([ITEM.sso]);
    expect(moveInput(roadmap.items[1]!, "now", 2)).toEqual({ itemId: ITEM.sso, horizon: "now", index: 2 });
    expect(moveInput(roadmap.items[1]!, "now", -1)).toEqual({ itemId: ITEM.sso, horizon: "now", index: 0 });
    // Another column is always a move; inside the column only a new place is.
    const billing = cols.now[0]!;
    expect(isMove(cols, billing, "next", 0)).toBe(true);
    expect(isMove(cols, billing, "now", 0)).toBe(false);
    expect(isMove(cols, billing, "now", 1)).toBe(true);
    expect(isMove(cols, cols.now[1]!, "now", 5)).toBe(false);
    expect(adjacentHorizon("now", -1)).toBeNull();
    expect(adjacentHorizon("now", 1)).toBe("next");
    expect(adjacentHorizon("later", 1)).toBeNull();
  });
  it("indexes dependencies in both shapes", () => {
    const idx = indexDependencies([{ fromItem: "a", toItem: "b" }, { fromId: "c", toId: "b" }, { fromItem: "x" }]);
    expect(idx.after.get("b")).toEqual(["a", "c"]);
    expect(idx.before.get("a")).toEqual(["b"]);
  });
  it("scales the timeline around the scheduled items and today", () => {
    const today = new Date("2026-10-07T12:00:00Z");
    const scale = timelineScale(roadmap.items, today);
    expect(scale.start.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(scale.end.toISOString().slice(0, 10)).toBe("2026-12-07");
    expect(scale.today).toBeGreaterThan(0);
    expect(scale.today).toBeLessThan(1);
    expect(scale.ticks.map((t) => t.label)).toEqual(["Sep", "Oct", "Nov", "Dec"]);
    const span = barSpan(roadmap.items[0]!, scale)!;
    expect(span.left).toBeGreaterThan(0.3);
    expect(span.width).toBeGreaterThan(0.2);
    expect(barSpan({ targetStart: null, targetEnd: null }, scale)).toBeNull();
    expect(barSpan({ targetStart: null, targetEnd: "2026-10-20" }, scale)!.width).toBeCloseTo(8 / scale.days, 5);
    expect(timelineScale([], today).days).toBe(56);
  });
  it("validates drafts and builds the upsert input", () => {
    expect(validateDraft(draftFrom(null))).toBe("Give the item a title.");
    expect(validateDraft({ ...draftFrom(null), title: "x", targetStart: "2026-10-10", targetEnd: "2026-10-01" })).toMatch(/before the start/);
    expect(upsertInput({ ...draftFrom(null), title: " Title " })).toMatchObject({ title: "Title", targetStart: null, targetEnd: null, horizon: "next" });
  });
});

describe("change proposal helpers", () => {
  it("builds diff sides, counts decisions and formats impact as estimates", () => {
    const sides = hunkSides(proposalAnnual.hunks[0]!);
    expect(sides.base).toContain("10 EUR");
    expect(sides.original).toContain("12 EUR");
    expect(sides.proposed).toContain("Annual plan");
    expect(hunkSides(proposalAnnual.hunks[1]!).base).toBeUndefined();
    expect(decisionProgress(proposalAnnual.hunks)).toEqual({ total: 3, decided: 1, accepted: 1, rejected: 0, edited: 0, pending: 2 });
    expect(isSettled(proposalAnnual)).toBe(false);
    const lines = impactLines(proposalAnnual.impact, "EUR");
    expect(lines.map((l) => l.label)).toEqual(["Dates", "Tasks", "Cost"]);
    expect(lines[0]!.value).toBe("+4 days");
    expect(lines[2]!.value).toContain("1,200");
    expect(lines.every((l) => l.estimate)).toBe(true);
    expect(impactLines({ tasks: ["a", "b"], dates: { from: "2026-10-01", to: "2026-10-05" } }, "EUR")).toEqual([
      { label: "Dates", value: "2026-10-01 → 2026-10-05", estimate: true },
      { label: "Tasks", value: "2 tasks: a, b", estimate: true },
    ]);
    expect(impactLines(null, "EUR")).toEqual([]);
  });
});

describe("spec outline order (AC-10)", () => {
  const outline = (sections: string[], start = 0): SpecBlockRow[] => sections.map((section, i) => ({ ...blocks[0]!, id: `b-${section}`, section, position: start + i }));
  const order = (rows: SpecBlockRow[]) => groupBySection(rows).map((g) => g.section);

  it("follows the archetype outline as stored, not a fixed list", () => {
    // The hardware outline (packages/agents archetypes.ts), shuffled as the API might return it.
    const hardware = ["Problem", "Customers", "Value proposition", "Features", "Firmware and app", "Formulation / BOM", "Manufacturing", "Packaging", "Compliance", "Fulfillment", "Non-functional requirements", "Data", "Integrations", "Pricing", "Metrics", "Risks"];
    expect(order(outline(hardware).reverse())).toEqual(hardware);
    const content = ["Problem", "Customers", "Value proposition", "Editorial formats and cadence", "Audience and membership", "Sponsorship and monetization", "Features", "Non-functional requirements", "Data", "Integrations", "Pricing", "Metrics", "Risks"];
    expect(order(outline(content).reverse())).toEqual(content);
  });

  it("keeps a section's blocks together by position and breaks position ties with the default order", () => {
    const rows = [...outline(["Problem", "Features", "Risks"]), { ...blocks[0]!, id: "b-features-2", section: "Features", position: 7 }, { ...blocks[0]!, id: "b-later", section: "Go-to-market", position: 3 }];
    const groups = groupBySection(rows);
    expect(groups.map((g) => g.section)).toEqual(["Problem", "Features", "Risks", "Go-to-market"]);
    expect(groups[1]!.blocks.map((b) => b.id)).toEqual(["b-Features", "b-features-2"]);
    // Every block at position 0 (blocks added one per section): the default order decides, in the seeds' spelling.
    expect(order(outline(["Risks", "Non-functional requirements", "Formulation / BOM", "Features", "Problem"]).map((b) => ({ ...b, position: 0 })))).toEqual(["Problem", "Features", "Formulation / BOM", "Non-functional requirements", "Risks"]);
    expect(compareSections("Non-functional", "Data")).toBeLessThan(0);
    expect(compareSections("Fulfilment", "Fulfillment")).toBe(0);
    expect(compareSections("Zebra notes", "Risks")).toBeGreaterThan(0);
  });
});

describe("source helpers", () => {
  it("opens only http(s) links from the browser, whatever a stored row says (ARB-17)", () => {
    expect(isWebUri("https://example.com/a")).toBe(true);
    expect(isWebUri(" HTTP://example.com")).toBe(true);
    for (const uri of ["javascript:alert(1)", "data:text/html,x", "s3://bucket/key", "ftp://x", "example.com", "", null, undefined]) expect(isWebUri(uri), String(uri)).toBe(false);
  });

  it("reads linked blocks best-first, counts coverage per section and topics", () => {
    expect(linkedBlocks(sources[0]!)).toEqual([{ blockId: BLOCK.pricing, score: 0.82 }]);
    const coverage = coverageBySection(sources, blocks);
    expect(coverage.find((c) => c.section === "Pricing")?.count).toBe(1);
    expect(coverage.find((c) => c.section === "Features")?.count).toBe(1);
    expect(coverage.find((c) => c.section === "Metrics")?.count).toBe(0);
    expect(topicCounts(sources)).toEqual([
      { topic: "pricing", count: 1 },
      { topic: "reminders", count: 1 },
    ]);
  });
  it("validates the add-source draft", () => {
    expect(validateSourceDraft({ kind: "doc", title: "", uri: "", notes: "" })).toMatch(/title or a link/);
    expect(validateSourceDraft({ kind: "doc", title: "", uri: "ftp://x", notes: "" })).toMatch(/http/);
    expect(validateSourceDraft({ kind: "doc", title: "", uri: "not a url", notes: "" })).toMatch(/URL/);
    expect(validateSourceDraft({ kind: "doc", title: "A note", uri: "", notes: "" })).toBeNull();
    expect(sourceInput({ kind: "competitor", title: "", uri: " https://x.example ", notes: "cheap" })).toEqual({ kind: "competitor", uri: "https://x.example", title: "https://x.example", relevance: { notes: "cheap" } });
  });
});

describe("sign-offs (founder, 2026-10-18)", () => {
  const formatDate = (d: string | Date) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const round = (status: "pending" | "approved" | "changes_requested" | "declined", extra: Partial<{ specVersion: number | null; decidedAt: string | null; notes: string | null }> = {}) => ({ id: "s1", kind: "spec" as const, round: 1, status, requestedAt: "2026-10-18T09:00:00.000Z", decidedAt: null, decidedBy: null, notes: null, specVersion: null, inboxItemId: "i1", ...extra });
  it("words the pill: awaiting, signed off with the date and version, changes requested; nothing when nothing was asked", () => {
    expect(signoffStatusWord(null, formatDate)).toBeNull();
    expect(signoffStatusWord(round("pending"), formatDate)).toEqual({ tone: "warn", word: "Awaiting your sign-off", actionable: true });
    expect(signoffStatusWord(round("approved", { decidedAt: "2026-10-18T10:00:00.000Z", specVersion: 2 }), formatDate)).toEqual({ tone: "good", word: "Signed off Oct 18, 2026 · v2", actionable: false });
    expect(signoffStatusWord(round("approved", { decidedAt: "2026-10-18T10:00:00.000Z" }), formatDate)!.word).toBe("Signed off Oct 18, 2026");
    expect(signoffStatusWord(round("changes_requested"), formatDate)).toEqual({ tone: "warn", word: "Changes requested", actionable: true });
  });
  it("sums both rounds up in one line for the Vision tab", () => {
    expect(signoffSummaryLine(undefined)).toBeNull();
    expect(signoffSummaryLine({ spec: null, roadmap: null })).toBeNull();
    expect(signoffSummaryLine({ spec: round("approved"), roadmap: { ...round("pending"), kind: "roadmap" } })).toBe("Specification: signed off · Roadmap: awaiting your sign-off");
    expect(signoffSummaryLine({ spec: round("changes_requested"), roadmap: null })).toBe("Specification: changes requested · Roadmap: not asked yet");
  });
});
