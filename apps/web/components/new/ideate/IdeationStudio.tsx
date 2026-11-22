"use client";
/**
 * /new/ideate — the Ideation Studio (BUILD §11.1 Door A; AC-11.1.2, AC-11.1.3). The brief and its generate control
 * (DIRECTION #14: the light slab "Draft concepts" / "Draft 6–12 ideas for me"; while running the dark slab with
 * the real count "2 of 12" and Stop beside it) → idea.draft, streamed (audit P2): the live run under the brief (steps,
 * one bar segment per concept, elapsed and time left, the slate's names) and the concepts named as the slate arrives,
 * each card filling its place the moment it is saved ("Just in"); existing cards stay visible (dimmed) meanwhile.
 * Three example briefs sit above the textarea until the first card exists (an `ExampleToggle` group, "Try an example
 * brief", UX plan §6.2): a chip fills the brief and tags the textarea Example until the founder edits it, the chosen
 * chip again clears it, and nothing is drafted until Draft is pressed; the control then reads "Draft 6–12 ideas from
 * this example". The empty-brief control reads "Draft 6–12 ideas for me" (A7). Steering chips ("Cheaper to start",
 * "B2B instead", "More defensible") prefill the brief for the next set. Cards are 6–12 ConceptCards (Dugout profile cards: the initials mark until a logo is chosen at Commit,
 * stars, ten attribute bars with evidence hover and a definition on every label, citation count), with the
 * "How to read a card" Explainer over the deck while guidance is on (screen `ideate-cards`; "Got it" is remembered per
 * account in `explainers_seen`). Key caps (the generate control's ⌘↵, the compare shortcuts tip) show only while
 * guidance is off: an operator's affordance, the keys work either way (UX plan §5.9). Actions: Shortlist (local), Merge /
 * "More like this" (a variant) / Ask (idea.*, each a new version; Ask is the Research agent's desk as a sheet, with
 * starters and quick replies), Discard (idea.discard; Restore in the tray and the notice's Undo are idea.restore). Shortlisted and
 * restored cards older than the loaded pages are read by id (idea.listByIds) so they stay pinned and counted. Select
 * 2–4 cards → Compare. History opens every version. ⌘/Ctrl+Enter drafts from anywhere on the page.
 *
 * Ideation is private: no business exists yet, so there is no kit bar and nothing reaches Live.
 */
import type { FitBasis } from "@foundmill/config";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bookmark, CircleAlert, CircleCheck, Columns3, FileText, History, Info, Layers, PenLine, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ARCHETYPES, ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared";
import { Button, Chip, BusinessLogo, ConceptCard, EmptyState, ExampleFrame, ExampleToggle, Explainer, GenerateControl, IconButton, InfoTip, JustInTag, Kbd, Panel, SimpleSelect, Skeleton, SkeletonText, StatusPill, Term, Textarea, Tooltip, cn, landedCardClass, useGuided, useToast, useDateFormat, type ConceptAction, type QuickReplyItem } from "@foundmill/dugout";
import { useKeyboardMap } from "@/lib/keys";
import { formatDayMonth } from "@/lib/format";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { StudioFrame } from "../StudioFrame";
import { SharpenOffer } from "./SharpenOffer";
import { COMPARE_MAX, COMPARE_MIN, attributeChanges, buildDeck, CHOOSE_IDEA_LABEL, commitHref, compareHref, discardLocally, lineageOf, orderDeck, pinnedIdsToLoad, restoreLocally, settlePinned, toConcept, toggleSelection, withPinned, type IdeaLike, type IdeaVersionLike } from "./concepts";
import { conceptErrorMessage } from "./concept-errors";
import { AskDialog, EditDialog, ForkDialog, HistoryDialog, MergeDialog, WriteDialog, type AskExchange, type AskInput } from "./dialogs";
import { DraftStatus, DraftingCard } from "./DraftStatus";
import { deckFromPages, draftedCount, gridEntries, prependIdeaToPages, slotsOf } from "./draft-run";
import { useDraftRun } from "./use-draft-run";
import { useStudioState } from "./use-studio-state";

export interface IdeationStudioProps {
  viewer: { email: string | null };
  profileLine?: string | null;
  /** The founder's constraint chips, echoed next to "surprise me". */
  constraints?: string[];
  /**
   * The card to open on (`/new/ideate/<ideaId>`: the landing page's kept card, founder 2026-11-16): once the deck has
   * it, it wears the just-landed highlight, is scrolled into view and takes focus, ready to shape with its own actions.
   */
  focusIdeaId?: string | null;
  /** What Founder fit rests on (`fitBasisOf` the profile): each card says "quick profile" until the long profile is saved (WP-14 T2). */
  fitBasis?: FitBasis;
  /** The person just saved the long profile over a quick one (`?sharpened=1`): fit was re-rated, and a fresh set is offered. */
  sharpened?: boolean;
  /** The account, for remembering "Not now" on the sharpen offer. */
  accountId?: string | null;
}

/**
 * Three example briefs above the textarea while the deck is empty (docs/UX_AUDIT_AND_PLAN.md §7.5, A7; §6.2
 * ExampleToggle): a chip fills the brief with its sentence; nothing is drafted until Draft is pressed. Hidden once a
 * card exists, and when guidance is off.
 */
export const EXAMPLE_BRIEFS: readonly string[] = ["Help independent tutors send parents a weekly recap", "A subscription for refillable skincare", "AI playtesters for indie games"];

/** The group's lead label. */
export const EXAMPLE_BRIEF_LABEL = "Try an example brief";

/** The briefs as the toggle's options: the sentence is both the chip and the id. */
export const EXAMPLE_BRIEF_OPTIONS: readonly { id: string; label: string }[] = EXAMPLE_BRIEFS.map((text) => ({ id: text, label: text }));

/** The generate control's label with an empty brief: what will happen, in the founder's words (A7). */
export const DRAFT_FOR_ME = "Draft 6–12 ideas for me";

/**
 * "Use my idea as written" (first-time founder report, Nov 8, 2026): a founder who arrives with an idea should not have
 * to pick the nearest of ten drafted cards. Shown beside Draft whenever the brief holds the founder's own words (not an
 * untouched example brief, not empty): one card from those words, rated by the agent, straight to Commit.
 */
export const USE_MY_IDEA = "Use my idea as written";

export function showsUseMyIdea(prompt: string, exampleIn: boolean, busy: boolean): boolean {
  return prompt.trim().length > 0 && !exampleIn && !busy;
}

/** The generate control's label while an example brief is in, untouched: the example is drafted from, never by itself. */
export const DRAFT_FROM_EXAMPLE = "Draft 6–12 ideas from this example";

/** What the generate control says: for an empty brief, from an example brief, or from the founder's own words. */
export function generateLabel(prompt: string, exampleIn: boolean): string {
  if (!prompt.trim()) return DRAFT_FOR_ME;
  return exampleIn ? DRAFT_FROM_EXAMPLE : "Draft concepts";
}

/** True while the brief is exactly the example the founder chose: an edit, however small, makes it theirs. */
export function exampleBriefIn(prompt: string, example: string | null): boolean {
  return example !== null && prompt === example;
}

/**
 * "How to read a card" over the deck (UX plan §7.5, A6): the Explainer for the `ideate-cards` screen. What a card is,
 * what to do with it, and which way the numbers read; "Got it" is kept per account in `explainers_seen`.
 */
export const HOW_TO_READ_CARD = {
  screenId: "ideate-cards",
  purpose: "Each card is one business idea the Ideation agent drafted within your profile, rated on ten attributes.",
  action: "Shortlist the ones you like, ask the Research agent about any card, then pick 2–4 to compare them.",
  watchFor: "Every bar runs 1–20 and higher is always the better side; hover a label for what it measures. Stars are how strong the idea is now and could get.",
} as const;

/** Steer the next set (DIRECTION #14): each chip adds one sentence to the brief; nothing is drafted until you press Draft. */
export const STEERING_CHIPS: readonly { id: string; label: string; text: string }[] = [
  { id: "cheaper", label: "Cheaper to start", text: "Cheaper to start: little upfront cost, no stock to buy before the first sale." },
  { id: "b2b", label: "B2B instead", text: "Sell to businesses rather than consumers." },
  { id: "defensible", label: "More defensible", text: "More defensible: favor data, network effects, regulation or supply that others cannot copy quickly." },
];

/** The brief with a steering sentence added once (pressing the same chip twice changes nothing). */
export function steerBrief(brief: string, text: string): string {
  const b = brief.trim();
  if (b.includes(text)) return b;
  return b ? `${b} ${text}` : text;
}

type DraftInput = { prompt: string; archetypeHint?: Archetype };
/**
 * One page of the deck, newest first (12 rows of four at 1440): older cards load on demand ("Show older concepts"), so
 * every card stays reachable however large the deck grows, and the Studio paints quickly.
 */
const DECK_PAGE = 48;
/** The archetype hint's options: "Any" first (the label beside the select is the defined word, `Term` archetype). */
const ARCHETYPE_OPTIONS = [{ value: "any", label: "Any (optional)" }, ...ARCHETYPES.map((a) => ({ value: a, label: ARCHETYPE_LABELS[a] }))];

type DialogKind = "ask" | "fork" | "merge" | "history" | "write" | "edit" | null;

export function IdeationStudio({ viewer, profileLine, constraints = [], focusIdeaId = null, fitBasis = "full", sharpened = false, accountId = null }: IdeationStudioProps) {
  const datePrefs = useDateFormat();
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const userKey = viewer.email ?? "dev";
  const [studio, updateStudio, hydrated] = useStudioState(userKey);

  const ideasQ = useInfiniteQuery(trpc.idea.list.infiniteQueryOptions({ limit: DECK_PAGE }, { getNextPageParam: (last) => last.nextCursor ?? undefined, initialCursor: null, staleTime: 10_000 }));
  const serverIdeas = useMemo<IdeaLike[]>(() => deckFromPages(ideasQ.data?.pages), [ideasQ.data]);
  // Shortlisted and restored cards older than every loaded page are asked for by id, so they stay pinned and counted.
  const loadedIds = useMemo(() => new Set(serverIdeas.map((i) => i.id)), [serverIdeas]);
  const pinIds = useMemo(() => (ideasQ.isSuccess ? pinnedIdsToLoad(studio, loadedIds) : []), [ideasQ.isSuccess, studio, loadedIds]);
  const pinnedQ = useQuery(trpc.idea.listByIds.queryOptions({ ideaIds: pinIds }, { enabled: hydrated && pinIds.length > 0, staleTime: 0 }));
  const pinnedAnswer = pinIds.length > 0 && pinnedQ.isSuccess && !pinnedQ.isFetching ? pinnedQ.data : null;
  useEffect(() => {
    if (!hydrated || !ideasQ.isSuccess || ideasQ.isFetching) return;
    updateStudio((s) => settlePinned(s, loadedIds, pinnedAnswer ? { asked: pinIds, found: pinnedAnswer.items.map((i) => i.id), discarded: pinnedAnswer.discardedIds } : null));
  }, [hydrated, ideasQ.isSuccess, ideasQ.isFetching, loadedIds, pinIds, pinnedAnswer, updateStudio]);
  const liveIdeas = useMemo(() => withPinned(serverIdeas, pinnedQ.data?.items as IdeaLike[] | undefined), [serverIdeas, pinnedQ.data]);
  const deck = useMemo(() => orderDeck(buildDeck(liveIdeas, studio), studio.shortlist), [liveIdeas, studio]);
  const titleOf = useCallback((id: string) => [...deck, ...studio.discarded.map((d) => d.idea)].find((i) => i.id === id)?.title, [deck, studio.discarded]);

  const [prompt, setPrompt] = useState("");
  // The example brief the founder chose, while the brief still reads exactly that (an edit makes the brief theirs).
  const [example, setExample] = useState<string | null>(null);
  const [archetypeHint, setArchetypeHint] = useState<string>("any");
  const [selection, setSelection] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // This session's Ask exchanges per card (the card's stored history fills the sheet; these follow it, never twice).
  const [exchanges, setExchanges] = useState<Record<string, AskExchange[]>>({});
  const [trayOpen, setTrayOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hydrated && studio.lastPrompt && !prompt) setPrompt(studio.lastPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed the prompt once after hydration
  }, [hydrated]);

  const active = useMemo(() => deck.find((i) => i.id === activeId) ?? null, [deck, activeId]);
  // The card the page opened on: scrolled to and focused once, the first time the deck holds it.
  const focused = useRef(false);
  useEffect(() => {
    if (!focusIdeaId || focused.current || !deck.some((i) => i.id === focusIdeaId)) return;
    focused.current = true;
    requestAnimationFrame(() => {
      const el = document.getElementById(`concept-${focusIdeaId}`);
      el?.scrollIntoView({ block: "center" });
      el?.querySelector<HTMLElement>("button, a[href]")?.focus({ preventScroll: true });
    });
  }, [deck, focusIdeaId]);
  const invalidateIdeas = () => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("idea") as unknown[] });

  const client = useTRPCClient();
  const listKey = trpc.idea.list.infiniteQueryKey({ limit: DECK_PAGE });
  // Outcomes are said in place, never in a toast over the cards: the live run panel under the brief reports a draft
  // (done, stopped, failed, with its time and cost), and the deck's own notice line reports card actions.
  const [notice, setNotice] = useState<StudioNotice | null>(null);
  const say = useCallback((n: Omit<StudioNotice, "id">) => setNotice({ ...n, id: Date.now() }), []);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice((cur) => (cur?.id === notice.id ? null : cur)), NOTICE_MS);
    return () => window.clearTimeout(t);
  }, [notice]);
  const draft = useDraftRun((input: DraftInput, signal) => client.idea.draft.mutate(input, { signal }), {
    // Each saved card goes straight into the deck's cache: no refetch of the whole list.
    onIdea: (idea) => queryClient.setQueryData(listKey, (old) => prependIdeaToPages(old, idea)),
    onStop: () => {
      // A card saved in the last instant may not have reached the stream: read the deck once more.
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
  });
  const { run, running } = draft;

  const merge = useMutation(
    trpc.idea.merge.mutationOptions({
      onSuccess: async (merged) => {
        await invalidateIdeas();
        setDialog(null);
        setSelection([]);
        say({ text: `Merged: ${merged.title} is a new card; the sources keep a "merged" version.`, tone: "good" });
      },
    }),
  );
  const fork = useMutation(
    trpc.idea.fork.mutationOptions({
      onSuccess: async (forked) => {
        await invalidateIdeas();
        setDialog(null);
        say({ text: `More like this: ${forked.title} has its own history now.`, tone: "good" });
      },
    }),
  );
  // "Use my idea as written": the card is the founder's words, rated; it goes straight to Commit (the deck keeps it).
  const write = useMutation(
    trpc.idea.write.mutationOptions({
      onSuccess: async (res) => {
        await invalidateIdeas();
        setDialog(null);
        router.push(commitHref(res.idea.id));
      },
    }),
  );
  // Edit: a new version with the founder's words; the deck shows it at once.
  const edit = useMutation(
    trpc.idea.edit.mutationOptions({
      onSuccess: async (res) => {
        await invalidateIdeas();
        setDialog(null);
        say({ text: `Saved ${res.idea.title} as version ${res.version.version}. Your words lead the card now; the team builds from them.`, tone: "good" });
      },
    }),
  );
  const ask = useMutation(trpc.idea.ask.mutationOptions());
  const askDeskQ = useQuery(trpc.idea.askDesk.queryOptions({ ideaId: activeId ?? "" }, { enabled: dialog === "ask" && Boolean(activeId), staleTime: Infinity }));
  const askIdea = useCallback(
    async (idea: IdeaLike, input: AskInput) => {
      // A starter (or a chip the server issued from them) goes by id; anything else is sent as the founder's words.
      const starterIds = new Set((askDeskQ.data?.starters ?? []).map((q) => q.id));
      const payload = "quickReplyId" in input && starterIds.has(input.quickReplyId) ? { ideaId: idea.id, quickReplyId: input.quickReplyId } : { ideaId: idea.id, question: "say" in input ? input.say : input.question };
      const res = await ask.mutateAsync(payload);
      const exchange: AskExchange = {
        id: res.version.id,
        question: res.question,
        bubbles: res.bubbles,
        quickReplies: res.quickReplies as QuickReplyItem[],
        reaction: res.reaction,
        at: new Date(),
        version: res.version.version,
        changes: attributeChanges(idea.current?.attributes, res.version.attributes as IdeaVersionLike["attributes"]),
      };
      setExchanges((x) => ({ ...x, [idea.id]: [...(x[idea.id] ?? []), exchange] }));
      void invalidateIdeas();
      return res;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidateIdeas is stable in effect (queryClient)
    [ask, askDeskQ.data],
  );
  const discard = useMutation(trpc.idea.discard.mutationOptions());
  const restoreIdea = useMutation(trpc.idea.restore.mutationOptions());

  const historyQ = useQuery(trpc.idea.get.queryOptions({ ideaId: activeId ?? "" }, { enabled: dialog === "history" && Boolean(activeId) }));

  async function runGenerate(e?: FormEvent) {
    e?.preventDefault();
    if (running) return;
    const p = prompt.trim();
    // Drafted from, the example brief is the founder's brief from here on.
    setExample(null);
    updateStudio((s) => ({ ...s, lastPrompt: p }));
    await draft.start({ prompt: p, archetypeHint: archetypeHint === "any" ? undefined : (archetypeHint as Archetype) });
  }

  // ⌘/Ctrl+Enter drafts from anywhere on the page (dialogs keep their own keys).
  const generateRef = useRef(runGenerate);
  generateRef.current = runGenerate;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || dialog !== null) return;
      e.preventDefault();
      void generateRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);
  const [modKey, setModKey] = useState("Ctrl");
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setModKey("⌘");
  }, []);
  // Key caps (the generate control's ⌘↵, the compare shortcuts tip) are an operator's affordance: shown only while
  // guidance is off; the keys work regardless (UX plan §5.9). The Explainer reads the switch itself.
  const guided = useGuided();
  // The example brief is tutoring (UX plan §6.2): in only while guidance is on, and only while untouched.
  const exampleIn = guided && exampleBriefIn(prompt, example);

  function onAction(action: ConceptAction, id: string) {
    const idea = deck.find((i) => i.id === id);
    if (!idea) return;
    setActiveId(id);
    switch (action) {
      case "shortlist":
        updateStudio((s) => ({ ...s, shortlist: s.shortlist.includes(id) ? s.shortlist.filter((x) => x !== id) : [...s.shortlist, id] }));
        return;
      case "merge":
      case "fork":
      case "ask":
      case "edit":
        setDialog(action);
        return;
      case "discard":
        runDiscard(idea);
        return;
    }
  }

  function runDiscard(idea: IdeaLike) {
    // Local first so the card leaves the deck at once; the API archives it (reversible: archived, never deleted).
    updateStudio((s) => discardLocally(s, idea));
    setSelection((sel) => sel.filter((x) => x !== idea.id));
    discard.mutate(
      { ideaId: idea.id },
      {
        onSuccess: () => say({ text: `Discarded ${idea.title}. It is in the tray; nothing is deleted.`, tone: "neutral", action: { label: "Undo", onClick: () => restore(idea.id) } }),
        onError: (err) => {
          updateStudio((s) => restoreLocally(s, idea.id));
          say({ text: `${idea.title} was not discarded: ${errorMessage(err)}`, tone: "bad" });
        },
      },
    );
  }

  function restore(ideaId: string) {
    // The API un-discards it first (idea.restore), so Ask, History, Compare and Commit work on the card again (AC-11.1.3);
    // it stays in the tray until then.
    const title = titleOf(ideaId) ?? "the card";
    restoreIdea.mutate(
      { ideaId },
      {
        onSuccess: (idea) => {
          updateStudio((s) => restoreLocally(s, ideaId, idea as IdeaLike));
          void invalidateIdeas();
          say({ text: `Restored ${title} to the deck.`, tone: "good" });
        },
        onError: (err) => say({ text: `${title} was not restored: ${conceptErrorMessage(err)}`, tone: "bad" }),
      },
    );
  }

  function openHistory(ideaId: string) {
    setActiveId(ideaId);
    setDialog("history");
  }

  const canCompare = selection.length >= COMPARE_MIN && selection.length <= COMPARE_MAX;
  const goCompare = useCallback(() => {
    if (selection.length >= COMPARE_MIN) router.push(compareHref(selection));
  }, [router, selection]);

  useKeyboardMap({
    enabled: dialog === null,
    // Esc clears the pick. Space is no page shortcut (WP-04 T13): Compare takes it only with focus, as any button does.
    onEscape: () => setSelection([]),
  });

  // Stable handlers, so a streamed card (or a ticking timer) re-renders only what changed, not every card in the deck.
  const latestHandlers = useRef({ onAction, openHistory });
  latestHandlers.current = { onAction, openHistory };
  const stableOnAction = useCallback((action: ConceptAction, id: string) => latestHandlers.current.onAction(action, id), []);
  const stableOpenHistory = useCallback((id: string) => latestHandlers.current.openHistory(id), []);
  const toggleSelect = useCallback((id: string) => setSelection((sel) => toggleSelection(sel, id)), []);

  const busy = running;
  const runDrafted = run ? draftedCount(run) : 0;
  const runTotal = run ? (run.total ?? (slotsOf(run).length || 0)) : 0;
  const showHero = !ideasQ.isLoading && deck.length === 0 && !run;
  const entries = useMemo(() => gridEntries(deck, run), [deck, run]);

  return (
    <StudioFrame
      step="ideate"
      title="Ideation Studio"
      lede={profileLine ? `Concepts drafted within your constraints · ${profileLine}` : "Concepts drafted within your constraints."}
      viewer={viewer}
      width="wide"
      actions={
        <>
          {studio.discarded.length > 0 ? (
            <Button variant="ghost" icon={Trash2} onClick={() => setTrayOpen((o) => !o)} aria-expanded={trayOpen} data-testid="tray-toggle">
              Discarded · {studio.discarded.length}
            </Button>
          ) : null}
          <Button variant={canCompare ? "primary" : "default"} icon={Columns3} disabled={!canCompare} onClick={goCompare} data-testid="compare-button">
            Compare {selection.length > 0 ? `· ${selection.length}` : ""}
          </Button>
        </>
      }
    >
      <form onSubmit={runGenerate} className={cn("surface-panel glow-brand mb-gutter overflow-hidden", showHero && "mx-auto max-w-[960px]")} data-testid="prompt-box">
        <div className="flex h-panel-header items-center gap-2 border-b border-subtle px-panel-pad">
          <FileText size={14} className="text-secondary" aria-hidden />
          <span className="t-title">Brief for the Ideation agent</span>
          <span className="ml-auto text-small text-secondary">Private · nothing reaches Live</span>
        </div>
        <div className={cn("flex flex-col gap-3 p-panel-pad", showHero && "p-5")}>
          {showHero ? (
            <div className="mb-1">
              <h2 className="t-display-lg">What should exist that does not yet?</h2>
              <p className="mt-2 max-w-reading text-body text-secondary">A concept, a problem, a market, or nothing at all. The Ideation agent drafts six to twelve cards and rates each on ten attributes, with the reasoning behind every rating. Ask the Research agent about any card to question its market, competitors or pricing.</p>
            </div>
          ) : null}
          {/* Example briefs while the deck is empty (A7, §6.2): a chip fills the brief and tags it; the founder still presses Draft. */}
          {deck.length === 0 && !ideasQ.isLoading ? (
            <ExampleToggle
              options={EXAMPLE_BRIEF_OPTIONS}
              label={EXAMPLE_BRIEF_LABEL}
              value={exampleIn ? example : null}
              disabled={busy}
              onFill={(id) => {
                const text = id ?? "";
                setPrompt(text);
                setExample(text);
                requestAnimationFrame(() => document.getElementById("ideation-prompt")?.focus());
              }}
              onClear={() => {
                setPrompt("");
                setExample(null);
              }}
              data-testid="example-briefs"
            />
          ) : null}
          {(() => {
            const textarea = (
              <Textarea
                id="ideation-prompt"
                aria-label="Brief"
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setExample(null);
                }}
                rows={showHero ? 4 : 2}
                maxLength={4000}
                placeholder="A problem you have seen, a market you know, or nothing at all."
                disabled={busy}
                autoGrow
                className={showHero ? "min-h-20" : "min-h-14"}
              />
            );
            // The brief wears the Example chip and the dashed edge while it is the example, untouched.
            return exampleIn ? <ExampleFrame data-testid="brief-example">{textarea}</ExampleFrame> : textarea;
          })()}
          <div className="flex flex-wrap items-center gap-2">
            {/* The defined word beside the select (A7, §7.5): "Kind of business" is what a founder reads; the card says it is the archetype. */}
            <span className="t-data" data-testid="archetype-hint-label">
              <Term id="archetype">Kind of business</Term>
            </span>
            <SimpleSelect aria-label="Kind of business" value={archetypeHint} onValueChange={setArchetypeHint} options={ARCHETYPE_OPTIONS} controlSize="sm" className="w-48" disabled={busy} />
            {constraints.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Your constraints">
                <span className="t-data">Within</span>
                {constraints.slice(0, 4).map((c) => (
                  <Chip key={c}>{c}</Chip>
                ))}
                {constraints.length > 4 ? <Chip>+{constraints.length - 4}</Chip> : null}
              </div>
            ) : null}
            <span className="ml-auto font-mono text-mono text-tertiary tabular-nums">{busy ? "Locked while drafting · " : ""}{prompt.length} / 4,000</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line-faint pt-3">
            {busy ? (
              <p className="min-w-0 flex-1 text-small text-secondary">Six to twelve cards. Each one lands as soon as it is written; the cards you have stay where they are.</p>
            ) : deck.length > 0 ? (
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label="Steer the next set" data-testid="steering-chips">
                <span className="t-data mr-1">Steer the next set</span>
                {STEERING_CHIPS.map((c) => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant="ghost"
                    icon={Plus}
                    aria-pressed={prompt.includes(c.text)}
                    data-steer={c.id}
                    onClick={() => {
                      setPrompt((p) => steerBrief(p, c.text));
                      requestAnimationFrame(() => document.getElementById("ideation-prompt")?.focus());
                    }}
                  >
                    {c.label}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="min-w-0 flex-1 text-small text-secondary">{prompt.trim() ? "Draft a set of concepts around your brief, or use your idea as written: one card in your words, rated, straight to Commit." : "Leave the brief empty and the Ideation agent drafts within your profile alone."}</p>
            )}
            {showsUseMyIdea(prompt, exampleIn, busy) ? (
              <Button type="button" variant="default" icon={PenLine} onClick={() => setDialog("write")} data-testid="use-my-idea" className="ml-auto">
                {USE_MY_IDEA}
              </Button>
            ) : null}
            <GenerateControl
              type="submit"
              label={generateLabel(prompt, exampleIn)}
              runningLabel="Drafting concepts"
              running={busy}
              progress={busy && runTotal ? runDrafted / runTotal : undefined}
              count={busy && runTotal ? `${runDrafted} of ${runTotal}${run?.total === null ? "+" : ""}` : undefined}
              onStop={draft.stop}
              kbd={guided ? undefined : `${modKey} ↵`}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              data-testid="generate-button"
              wrapperClassName={showsUseMyIdea(prompt, exampleIn, busy) ? undefined : "ml-auto"}
            />
          </div>
          {run && run.status === "failed" ? (
            <StatusPill tone="bad" role="alert">
              {run.error}
            </StatusPill>
          ) : null}
        </div>
        {run ? (
          <div className="border-t border-line-faint px-panel-pad pb-panel-pad pt-3">
            <DraftStatus run={run} />
          </div>
        ) : null}
      </form>

      {trayOpen && studio.discarded.length > 0 ? (
        <Panel title={`Discarded · ${studio.discarded.length}`} className="mb-gutter" data-testid="discard-tray" actions={<IconButton icon={X} label="Close tray" size="sm" variant="ghost" onClick={() => setTrayOpen(false)} />}>
          <ul className="grid grid-cols-3 gap-gutter">
            {studio.discarded.map(({ idea, discardedAt }) => {
              const c = toConcept(idea);
              return (
                <li key={idea.id} className="flex items-center gap-3 rounded-panel border border-subtle bg-panel-alt p-3" data-discarded={idea.id}>
                  <BusinessLogo name={c.name} primary={c.kit.primary} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body-strong">{c.name}</div>
                    <div className="text-small text-secondary">Discarded {formatDayMonth(discardedAt, datePrefs)}</div>
                  </div>
                  <Button size="sm" icon={RotateCcw} onClick={() => restore(idea.id)} loading={restoreIdea.isPending && restoreIdea.variables?.ideaId === idea.id} data-testid="restore-button">
                    Restore
                  </Button>
                </li>
              );
            })}
          </ul>
        </Panel>
      ) : null}

      <div ref={gridRef} className="scroll-mt-6">
        {ideasQ.isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-gutter" aria-busy="true" aria-label="Loading concepts">
            {Array.from({ length: 3 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : ideasQ.error ? (
          <Panel title="Concepts" error="Could not load your concepts." onRetry={() => ideasQ.refetch()} />
        ) : (
          <>
            {notice && deck.length === 0 ? <NoticeLine notice={notice} onDismiss={() => setNotice(null)} className="mb-3" /> : null}
            {deck.length > 0 ? <Explainer {...HOW_TO_READ_CARD} className="mb-3" data-testid="how-to-read-card" /> : null}
            <SharpenOffer basis={fitBasis} sharpened={sharpened} hasIdeas={deck.length > 0} accountId={accountId} onRedraft={() => void generateRef.current()} busy={busy} />
            {deck.length > 0 ? (
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="t-label tabular-nums" data-testid="deck-count">
                  {ideasQ.hasNextPage ? `${deck.length} newest concepts` : `${deck.length} concepts`}
                </span>
                {studio.shortlist.length > 0 ? (
                  <Chip icon={Bookmark} tone="kit">
                    {studio.shortlist.filter((id) => deck.some((d) => d.id === id)).length} shortlisted
                  </Chip>
                ) : null}
                {notice ? <NoticeLine notice={notice} onDismiss={() => setNotice(null)} /> : null}
                <span className="ml-auto flex items-center gap-1.5 text-small text-secondary" data-testid="compare-hint">
                  Pick 2–4 cards to compare them
                  {/* The key caps behind a tip (A19): an operator's affordance, so only while guidance is off; the keys work either way. */}
                  {guided ? null : (
                    <span data-testid="compare-kbd-tip">
                      <InfoTip always label="Keyboard shortcuts for comparing">
                        <span className="flex items-center gap-1.5">
                          <Kbd>Esc</Kbd> clears the pick
                        </span>
                      </InfoTip>
                    </span>
                  )}
                </span>
              </div>
            ) : null}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-gutter" data-testid="concept-grid" data-count={deck.length} aria-busy={busy || undefined}>
              {entries.map((entry) =>
                entry.kind === "placeholder" ? (
                  <DraftingCard key={`slot-${entry.slot.index}`} slot={entry.slot} />
                ) : (
                  <DeckCard key={entry.idea.id} fitBasis={fitBasis} idea={entry.idea} fresh={entry.fresh || entry.idea.id === focusIdeaId} dimmed={busy && !entry.fresh} selected={selection.includes(entry.idea.id)} shortlisted={studio.shortlist.includes(entry.idea.id)} onToggleSelect={toggleSelect} onAction={stableOnAction} onOpenHistory={stableOpenHistory} />
                ),
              )}
            </div>
            {ideasQ.hasNextPage ? (
              <div className="mt-gutter flex flex-wrap items-center justify-center gap-3">
                <span className="text-small text-secondary">Older concepts are still in your deck.</span>
                <Button icon={History} loading={ideasQ.isFetchingNextPage} onClick={() => void ideasQ.fetchNextPage()} data-testid="deck-more">
                  Show older concepts
                </Button>
              </div>
            ) : null}
            {showHero ? (
              <EmptyState icon={Layers} title="No concepts yet" className="mt-gutter">
                Draft a set above. Cards you shortlist stay here until you commit one; nothing leaves your account.
              </EmptyState>
            ) : null}
          </>
        )}
      </div>

      {selection.length > 0 ? (
        <div className="sticky bottom-4 mt-gutter flex items-center gap-3 rounded-panel border border-subtle bg-panel-alt p-2 shadow-overlay" role="region" aria-label="Compare selection" data-testid="compare-bar">
          <div className="flex items-center gap-1.5">
            {selection.map((id) => {
              const idea = deck.find((i) => i.id === id);
              if (!idea) return null;
              const c = toConcept(idea);
              return (
                <Tooltip key={id} content={c.name}>
                  <span>
                    <BusinessLogo name={c.name} primary={c.kit.primary} size={32} />
                  </span>
                </Tooltip>
              );
            })}
          </div>
          <span className="text-body text-secondary tabular-nums">
            {selection.length} of {COMPARE_MAX} selected{selection.length < COMPARE_MIN ? ` · pick ${COMPARE_MIN - selection.length} more` : ""}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {selection.length >= 2 ? (
              <Button
                variant="default"
                onClick={() => {
                  setActiveId(selection[0]!);
                  setDialog("merge");
                }}
              >
                Merge these
              </Button>
            ) : null}
            <Button variant="ghost" icon={X} onClick={() => setSelection([])}>
              Clear
            </Button>
            <Button variant="primary" icon={Columns3} disabled={!canCompare} onClick={goCompare}>
              Compare
            </Button>
          </div>
        </div>
      ) : null}

      <AskDialog
        idea={active}
        open={dialog === "ask"}
        onOpenChange={(o) => !o && setDialog(null)}
        persona={askDeskQ.data?.persona ?? null}
        starters={(askDeskQ.data?.starters ?? []) as QuickReplyItem[]}
        exchanges={active ? (exchanges[active.id] ?? []) : []}
        onAsk={(input) => (active ? askIdea(active, input) : Promise.resolve())}
        busy={ask.isPending}
        error={ask.error ? conceptErrorMessage(ask.error) : askDeskQ.error ? conceptErrorMessage(askDeskQ.error) : null}
      />
      <ForkDialog idea={active} open={dialog === "fork"} onOpenChange={(o) => !o && setDialog(null)} onFork={(input) => active && fork.mutate({ ideaId: active.id, ...input })} busy={fork.isPending} error={fork.error ? conceptErrorMessage(fork.error) : null} />
      <WriteDialog open={dialog === "write"} onOpenChange={(o) => !o && setDialog(null)} brief={prompt} archetypeHint={archetypeHint === "any" ? null : archetypeHint} onWrite={(input) => write.mutate(input)} busy={write.isPending || write.isSuccess} error={write.error ? conceptErrorMessage(write.error) : null} />
      <EditDialog idea={active} open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} onEdit={(input) => active && edit.mutate({ ideaId: active.id, ...input })} busy={edit.isPending} error={edit.error ? conceptErrorMessage(edit.error) : null} />
      <MergeDialog source={active} candidates={deck} preselected={selection} open={dialog === "merge"} onOpenChange={(o) => !o && setDialog(null)} onMerge={(input) => merge.mutate(input)} busy={merge.isPending} error={merge.error ? conceptErrorMessage(merge.error) : null} />
      <HistoryDialog
        idea={active}
        versions={historyQ.data?.versions}
        loading={historyQ.isLoading}
        open={dialog === "history"}
        onOpenChange={(o) => !o && setDialog(null)}
        lineage={active ? lineageOf(active) : undefined}
        titleOf={titleOf}
        onOpenIdea={(id) => {
          if (deck.some((i) => i.id === id)) {
            openHistory(id);
            document.getElementById(`concept-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          } else toast({ title: "Not in the deck", description: "That card was discarded or merged; restore it from the tray to open it.", tone: "info" });
        }}
      />
    </StudioFrame>
  );
}

interface DeckCardProps {
  idea: IdeaLike;
  /** Drafted in the current run (pinned first, never dimmed). */
  fresh: boolean;
  /** An older card while a draft runs: stays in place, dimmed. */
  dimmed: boolean;
  selected: boolean;
  shortlisted: boolean;
  onToggleSelect: (id: string) => void;
  onAction: (action: ConceptAction, id: string) => void;
  onOpenHistory: (id: string) => void;
  fitBasis: FitBasis;
}

/** One card of the deck. Memoised: the brand colours and ten attribute bars are only recomputed when the idea changes. */
const DeckCard = memo(function DeckCard({ idea, fresh, dimmed, selected, shortlisted, onToggleSelect, onAction, onOpenHistory, fitBasis }: DeckCardProps) {
  const concept = useMemo(() => toConcept(idea), [idea]);
  return (
    <div className={cn("relative transition-opacity duration-micro", dimmed && "opacity-60")} id={`concept-${idea.id}`} data-fresh={fresh || undefined}>
      <ConceptCard concept={concept} className={cn("w-full", fresh && landedCardClass({ justIn: true }))} shortlisted={shortlisted} selected={selected} onToggleSelect={onToggleSelect} onAction={onAction} fitBasis={fitBasis} />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Tooltip content="Every version of this card">
          <Button size="sm" variant="ghost" icon={History} onClick={() => onOpenHistory(idea.id)} data-testid="history-button">
            History{concept.version && concept.version > 1 ? ` · version ${concept.version}` : ""}
          </Button>
        </Tooltip>
        {fresh ? <JustInTag /> : null}
        {/* What the press does, in plain words (DECISIONS 2026-11-10): it picks the idea and opens its setup, where Take charge starts the business. */}
        <LinkButton size="sm" variant="default" iconRight={ArrowRight} className="ml-auto" href={commitHref(idea.id)} data-testid="commit-link">
          {CHOOSE_IDEA_LABEL}
        </LinkButton>
      </div>
    </div>
  );
});

/** How long a deck notice stays (a new one replaces it at once). */
const NOTICE_MS = 8_000;

interface StudioNotice {
  id: number;
  text: string;
  tone: "good" | "neutral" | "bad" | "info";
  action?: { label: string; onClick: () => void };
}

/** A card action's outcome, said in the deck's header row (never a toast over the cards). Icon + words, never colour alone. */
function NoticeLine({ notice, onDismiss, className }: { notice: StudioNotice; onDismiss: () => void; className?: string }) {
  const Icon = notice.tone === "bad" ? CircleAlert : notice.tone === "good" ? CircleCheck : Info;
  return (
    <p role="status" aria-live="polite" className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-small", notice.tone === "bad" ? "text-status-bad" : "text-secondary", className)} data-testid="studio-notice" data-tone={notice.tone}>
      <Icon size={14} aria-hidden className={notice.tone === "good" ? "text-status-good" : undefined} />
      <span className="min-w-0 text-pretty">{notice.text}</span>
      {notice.action ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            notice.action!.onClick();
            onDismiss();
          }}
          data-testid="studio-notice-action"
        >
          {notice.action.label}
        </Button>
      ) : null}
      <IconButton size="sm" variant="ghost" icon={X} label="Dismiss" onClick={onDismiss} />
    </p>
  );
}

function CardSkeleton() {
  return (
    <div className="surface-panel flex flex-col gap-3 p-panel-pad" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="size-12" shape="circle" />
        <div className="flex-1">
          <Skeleton className="mb-1.5 h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <SkeletonText lines={2} />
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-2" />
      ))}
    </div>
  );
}
