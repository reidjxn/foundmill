/**
 * The Ideation Studio's live draft (audit P2/P8): the events `idea.draft` streams, folded into one state the Studio
 * renders: who is drafting, a slot per concept (named as soon as the slate names it, filled when its card is saved), a
 * progress line and the elapsed time. Pure, so it is unit-tested without a browser.
 */
import type { Archetype } from "@foundmill/shared";
import type { RouterOutputs } from "@/lib/trpc";

/** One event of `idea.draft` (the API's `DraftEvent`, as the client receives it). */
export type DraftEvent = RouterOutputs["idea"]["draft"] extends AsyncIterable<infer E> ? E : never;
export type DraftedIdea = Extract<DraftEvent, { type: "idea" }>["idea"];

export type SlotStatus = "outlined" | "writing" | "retrying" | "done" | "failed";

export interface DraftSlot {
  index: number;
  name: string;
  archetype: Archetype | null;
  status: SlotStatus;
  /** The saved idea, once its card is drafted. */
  ideaId: string | null;
}

export type RunStatus = "running" | "done" | "stopped" | "failed";

export interface DraftRun {
  status: RunStatus;
  /** Who is drafting ("Ideation agent"). */
  agent: string;
  startedAt: number;
  finishedAt: number | null;
  /** Slots by slate index (holes until the slate names them). */
  slots: DraftSlot[];
  /** Size of the set once the slate is complete; null while it is still being outlined. */
  total: number | null;
  error: string | null;
  costMinor: number | null;
  mock: boolean;
}

export const DEFAULT_DRAFTING_AGENT = "Ideation agent";

export function startRun(now: number): DraftRun {
  return { status: "running", agent: DEFAULT_DRAFTING_AGENT, startedAt: now, finishedAt: null, slots: [], total: null, error: null, costMinor: null, mock: false };
}

function setSlot(run: DraftRun, index: number, patch: Partial<DraftSlot>): DraftRun {
  const slots = [...run.slots];
  const current = slots[index] ?? { index, name: `Concept ${index + 1}`, archetype: null, status: "outlined" as const, ideaId: null };
  // A finished slot never goes back to writing (a late event cannot un-draft a saved card).
  if (current.status === "done" && patch.status && patch.status !== "done") return run;
  slots[index] = { ...current, ...patch };
  return { ...run, slots };
}

/** Folds one streamed event into the run. Events after the run ended (Stop) are ignored, except saved cards. */
export function applyDraftEvent(run: DraftRun, event: DraftEvent, now: number): DraftRun {
  if (run.status !== "running" && event.type !== "idea") return run;
  switch (event.type) {
    case "started":
      return { ...run, agent: event.agent, mock: event.mode === "mock" };
    case "outline":
      return setSlot(run, event.index, { name: event.name, archetype: event.archetype });
    case "outlined":
      return { ...run, total: event.total };
    case "writing":
      return setSlot(run, event.index, { status: event.attempt > 1 ? "retrying" : "writing" });
    case "idea":
      return setSlot(run, event.index, { status: "done", ideaId: event.idea.id, name: event.idea.title });
    case "card_failed":
      return setSlot(run, event.index, { status: "failed" });
    case "done":
      return { ...run, status: "done", finishedAt: now, total: event.total, costMinor: event.costMinor, mock: event.mode === "mock" };
  }
  return run;
}

export function stopRun(run: DraftRun, now: number): DraftRun {
  return run.status === "running" ? { ...run, status: "stopped", finishedAt: now } : run;
}

export function failRun(run: DraftRun, message: string, now: number): DraftRun {
  return run.status === "running" ? { ...run, status: "failed", finishedAt: now, error: message } : run;
}

export const slotsOf = (run: DraftRun): DraftSlot[] => run.slots.filter((s): s is DraftSlot => Boolean(s));
export const draftedCount = (run: DraftRun): number => slotsOf(run).filter((s) => s.status === "done").length;
export const failedCount = (run: DraftRun): number => slotsOf(run).filter((s) => s.status === "failed").length;

/** "0:07", "1:32". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The live status line: "Ideation agent is drafting concept 4 of 8". */
export function progressLine(run: DraftRun): string {
  const drafted = draftedCount(run);
  const named = slotsOf(run).length;
  const failed = failedCount(run);
  switch (run.status) {
    case "running": {
      if (named === 0) return `${run.agent} is reading your brief`;
      const total = run.total ?? named;
      if (run.total === null && drafted === 0) return `${run.agent} is outlining the set · ${plural(named, "concept")} named so far`;
      const next = Math.min(drafted + failed + 1, total);
      return `${run.agent} is drafting concept ${next} of ${total}${run.total === null ? "+" : ""}`;
    }
    case "done":
      return `${plural(drafted, "concept")} drafted${failed ? ` · ${failed} could not be finished` : ""}`;
    case "stopped":
      return drafted ? `Stopped · ${plural(drafted, "concept")} kept` : "Stopped before any concept was finished";
    case "failed":
      return run.error ?? "Nothing drafted";
  }
}

/** Ideas of the run in slate order (the deck shows them first, where their placeholders were). */
export function runIdeaIds(run: DraftRun | null): string[] {
  return run ? slotsOf(run).flatMap((s) => (s.ideaId ? [s.ideaId] : [])) : [];
}

/** `idea.list`'s page with a freshly saved idea on top (no refetch of the whole list). */
export function prependIdea<P extends { items: { id: string }[]; nextCursor: string | null }>(page: P | undefined, idea: P["items"][number]): P | undefined {
  if (!page) return page;
  return { ...page, items: [idea, ...page.items.filter((i) => i.id !== idea.id)] };
}

/**
 * The paged deck (`idea.list` as an infinite query, newest first) with a freshly saved idea on top of the first page;
 * removed from any later page it was already on, so it never shows twice.
 */
export function prependIdeaToPages<P extends { items: { id: string }[]; nextCursor: string | null }, D extends { pages: P[]; pageParams: unknown[] }>(data: D | undefined, idea: P["items"][number]): D | undefined {
  if (!data || data.pages.length === 0) return data;
  const [first, ...rest] = data.pages;
  return { ...data, pages: [prependIdea(first, idea)!, ...rest.map((p) => (p.items.some((i) => i.id === idea.id) ? { ...p, items: p.items.filter((i) => i.id !== idea.id) } : p))] };
}

/** Every card of the loaded pages once, newest first (a card can sit on two pages while the deck moves under it). */
export function deckFromPages<I extends { id: string }>(pages: readonly { items: readonly I[] }[] | undefined): I[] {
  const seen = new Set<string>();
  const out: I[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/**
 * What the grid shows, in order: the run's slots (a saved card, or a placeholder while its card is being written), then
 * the rest of the deck. Placeholders show only while the run is drafting; failed slots show nothing.
 */
export type GridEntry<I> = { kind: "idea"; idea: I; fresh: boolean } | { kind: "placeholder"; slot: DraftSlot };

export function gridEntries<I extends { id: string }>(deck: readonly I[], run: DraftRun | null): GridEntry<I>[] {
  if (!run) return deck.map((idea) => ({ kind: "idea", idea, fresh: false }));
  const byId = new Map(deck.map((i) => [i.id, i] as const));
  const out: GridEntry<I>[] = [];
  const pinned = new Set<string>();
  for (const slot of slotsOf(run)) {
    const idea = slot.ideaId ? byId.get(slot.ideaId) : undefined;
    if (idea) {
      out.push({ kind: "idea", idea, fresh: true });
      pinned.add(idea.id);
    } else if (run.status === "running" && slot.status !== "failed" && slot.status !== "done") out.push({ kind: "placeholder", slot });
  }
  for (const idea of deck) if (!pinned.has(idea.id)) out.push({ kind: "idea", idea, fresh: false });
  return out;
}

// --- the live run panel (SPEC "Live run panel"): steps, the card bar, the time left -----------------------------------

export type DraftStepState = "done" | "current" | "pending" | "failed";

export interface DraftStep {
  id: "profile" | "slate" | "cards" | "compare";
  label: string;
  detail: string;
  state: DraftStepState;
}

const writingCount = (run: DraftRun) => slotsOf(run).filter((s) => s.status === "writing" || s.status === "retrying").length;

/**
 * The run's steps, from what the stream has actually said: the brief and profile are read (the draft started), the
 * slate names its angles, each card is written and saved. Ranking is not part of a draft: the last step points at
 * Compare, where the Research agent ranks the cards the founder ticks.
 */
export function draftSteps(run: DraftRun): DraftStep[] {
  const named = slotsOf(run).length;
  const drafted = draftedCount(run);
  const failed = failedCount(run);
  const writing = writingCount(run);
  const ended = run.status !== "running";
  const broken = run.status === "failed" || run.status === "stopped";
  const total = run.total;
  const outlined = total !== null;
  const allCards = outlined && drafted + failed >= total;
  const profile: DraftStepState = named > 0 || outlined ? "done" : broken ? "failed" : ended ? "done" : "current";
  const slate: DraftStepState = outlined ? "done" : named > 0 ? (broken ? "failed" : "current") : "pending";
  const cards: DraftStepState = allCards || (run.status === "done" && drafted > 0) ? "done" : drafted > 0 || writing > 0 ? (broken ? "failed" : "current") : "pending";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return [
    { id: "profile", label: "Read your profile", detail: "Skills, time, budget and markets", state: profile },
    { id: "slate", label: outlined ? `Slate of ${total} angles` : named ? `Slate of ${named}+ angles` : "Slate of angles", detail: outlined ? "One angle per card" : named ? `${plural(named, "angle")} named so far` : "Names each concept first", state: slate },
    { id: "cards", label: "Drafting cards", detail: drafted || writing ? `${drafted} landed${writing ? ` · ${writing} in progress` : ""}${failed ? ` · ${failed} not finished` : ""}` : "Each card lands as soon as it is written", state: cards },
    { id: "compare", label: "Rank in Compare", detail: run.status === "done" ? "Pick 2–4 cards to rank them" : "When you pick 2–4 cards", state: "pending" },
  ];
}

export type DraftItemState = "landed" | "drafting" | "queued" | "empty" | "failed";

/** One bar segment per concept of the set: landed, drafting, queued (named), empty (not named yet), failed. */
export function draftItems(run: DraftRun): { id: string; state: DraftItemState; label: string }[] {
  const slots = run.slots;
  const size = Math.max(run.total ?? 0, slots.length);
  return Array.from({ length: size }, (_, i) => {
    const s = slots[i];
    if (!s) return { id: `slot-${i}`, state: "empty" as const, label: `Concept ${i + 1}` };
    const state: DraftItemState = s.status === "done" ? "landed" : s.status === "failed" ? "failed" : s.status === "writing" || s.status === "retrying" ? "drafting" : "queued";
    return { id: `slot-${i}`, state, label: s.name };
  });
}

/**
 * Time left (an Estimate): the pace so far (elapsed per finished card) times the cards still to come. Null until the
 * set's size is known and a card has finished.
 */
export function remainingEstimateMs(run: DraftRun, now: number): number | null {
  if (run.status !== "running" || run.total === null) return null;
  const finished = draftedCount(run) + failedCount(run);
  if (finished === 0) return null;
  const left = run.total - finished;
  if (left <= 0) return null;
  return Math.round(((now - run.startedAt) / finished) * left);
}

/** The names the slate has given so far, in order ("Patchwise · Northwind · Shelfproof"). */
export function slateLine(run: DraftRun): string {
  return slotsOf(run)
    .map((s) => s.name)
    .join(" · ");
}

/** The concepts being written right now, for "Ideation agent is drafting Shelfproof and Northwind". */
export function draftingNames(run: DraftRun, max = 2): string | null {
  const names = slotsOf(run)
    .filter((s) => s.status === "writing" || s.status === "retrying")
    .map((s) => s.name);
  if (!names.length) return null;
  if (names.length <= max) return names.join(" and ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}
