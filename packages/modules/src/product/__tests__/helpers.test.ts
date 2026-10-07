/** Pure helpers: ProseMirror text round trip, computed roadmap status, board moves, timeline scale, hunk progress, impact lines, source coverage. */
import { describe, expect, it } from "vitest";
import { pmExcerpt, pmTitle, pmToText, pmWordCount, textToPm } from "../prosemirror";
import { computeRoadmapStatus, taskSummary } from "../roadmap-status";
import { adjacentHorizon, barSpan, groupByHorizon, indexDependencies, moveInput, timelineScale } from "../roadmap/board";
import { decisionProgress, hunkSides, impactLines, isSettled } from "../changes/hunks";
import { coverageBySection, linkedBlocks, topicCounts } from "../sources/kinds";
import { validateSourceDraft, sourceInput } from "../sources/AddSourceDialog";
import { upsertInput, draftFrom, validateDraft } from "../roadmap/ItemDialog";
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
  it("groups by horizon in position order and moves keep every field but horizon and position", () => {
    const cols = groupByHorizon(roadmap.items);
    expect(cols.now.map((i) => i.id)).toEqual([ITEM.billing, ITEM.mobile]);
    expect(cols.next.map((i) => i.id)).toEqual([ITEM.sso]);
    const moved = moveInput(roadmap.items[1]!, "now", 2);
    expect(moved).toMatchObject({ id: ITEM.sso, title: "SSO for teams", horizon: "now", position: 2, status: "planned", specBlockIds: [BLOCK.features], targetStart: "2026-11-01" });
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
    expect(scale.ticks.map((t) => t.label)).toEqual(["Sept", "Oct", "Nov", "Dec"]);
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
    expect(impactLines({ tasks: ["a", "b"], dates: { from: "2026-10-01", to: "2026-10-05" } })).toEqual([
      { label: "Dates", value: "2026-10-01 → 2026-10-05", estimate: true },
      { label: "Tasks", value: "2 tasks: a, b", estimate: true },
    ]);
    expect(impactLines(null)).toEqual([]);
  });
});

describe("source helpers", () => {
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
    expect(sourceInput({ kind: "competitor", title: "", uri: " https://x.example ", notes: "cheap" })).toEqual({ kind: "competitor", uri: "https://x.example", title: "https://x.example", contentRef: null, relevance: { summary: "cheap" } });
  });
});
