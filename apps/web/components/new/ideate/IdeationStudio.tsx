"use client";
/**
 * /new/ideate — the Ideation Studio (BUILD §11.1 Door A; AC-11.1.2, AC-11.1.3). The brief and its generate control
 * (DIRECTION #14: the light slab "Draft concepts" / "Surprise me within my constraints"; while running the dark slab with
 * the real count "2 of 12" and Stop beside it) → idea.draft, streamed (audit P2): the live run under the brief (steps,
 * one bar segment per concept, elapsed and time left, the slate's names) and the concepts named as the slate arrives,
 * each card filling its place the moment it is saved ("Just in"); existing cards stay visible (dimmed) meanwhile.
 * Steering chips ("Cheaper to start", "B2B instead", "More defensible") prefill the brief for the next set. Cards are 6–12 ConceptCards (Dugout profile cards: the initials mark
 * until a logo is chosen at Commit, stars, ten AttributeBars with evidence hover, citation count). Actions: Shortlist
 * (local), Merge / Fork / Ask (idea.*, each a new version; Ask is the Research agent's desk as a sheet, with starters and
 * quick replies), Discard (idea.discard; reversible from the tray). Select 2–4
 * cards → Compare. History opens every version. ⌘/Ctrl+Enter drafts from anywhere on the page.
 *
 * Ideation is private: no business exists yet, so there is no kit bar and nothing reaches Live.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bookmark, CircleAlert, CircleCheck, Columns3, FileText, History, Info, Layers, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ARCHETYPES, ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared";
import { Button, Chip, BusinessLogo, ConceptCard, EmptyState, GenerateControl, IconButton, JustInTag, Kbd, Panel, SimpleSelect, Skeleton, SkeletonText, StatusPill, Textarea, Tooltip, cn, landedCardClass, useToast, type ConceptAction, type QuickReplyItem } from "@foundmill/dugout";
import { useKeyboardMap } from "@/lib/keys";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { StudioFrame } from "../StudioFrame";
import { COMPARE_MAX, COMPARE_MIN, attributeChanges, buildDeck, commitHref, compareHref, discardLocally, lineageOf, orderDeck, restoreLocally, toConcept, toggleSelection, type IdeaLike, type IdeaVersionLike } from "./concepts";
import { AskDialog, ForkDialog, HistoryDialog, MergeDialog, type AskExchange, type AskInput } from "./dialogs";
import { DraftStatus, DraftingCard } from "./DraftStatus";
import { deckFromPages, draftedCount, gridEntries, prependIdeaToPages, slotsOf } from "./draft-run";
import { useDraftRun } from "./use-draft-run";
import { useStudioState } from "./use-studio-state";

export interface IdeationStudioProps {
  viewer: { email: string | null };
  profileLine?: string | null;
  /** The founder's constraint chips, echoed next to "surprise me". */
  constraints?: string[];
}

const SURPRISE = "surprise me within my constraints";

/** Steer the next set (DIRECTION #14): each chip adds one sentence to the brief; nothing is drafted until you press Draft. */
export const STEERING_CHIPS: readonly { id: string; label: string; text: string }[] = [
  { id: "cheaper", label: "Cheaper to start", text: "Cheaper to start: little upfront cost, no stock to buy before the first sale." },
  { id: "b2b", label: "B2B instead", text: "Sell to businesses rather than consumers." },
  { id: "defensible", label: "More defensible", text: "More defensible: favour data, network effects, regulation or supply that others cannot copy quickly." },
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
const ARCHETYPE_OPTIONS = [{ value: "any", label: "Any archetype" }, ...ARCHETYPES.map((a) => ({ value: a, label: ARCHETYPE_LABELS[a] }))];

type DialogKind = "ask" | "fork" | "merge" | "history" | null;

export function IdeationStudio({ viewer, profileLine, constraints = [] }: IdeationStudioProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const userKey = viewer.email ?? "dev";
  const [studio, updateStudio, hydrated] = useStudioState(userKey);

  const ideasQ = useInfiniteQuery(trpc.idea.list.infiniteQueryOptions({ limit: DECK_PAGE }, { getNextPageParam: (last) => last.nextCursor ?? undefined, initialCursor: null, staleTime: 10_000 }));
  const serverIdeas = useMemo<IdeaLike[]>(() => deckFromPages(ideasQ.data?.pages), [ideasQ.data]);
  const deck = useMemo(() => orderDeck(buildDeck(serverIdeas, studio), studio.shortlist), [serverIdeas, studio]);
  const titleOf = useCallback((id: string) => [...deck, ...studio.discarded.map((d) => d.idea)].find((i) => i.id === id)?.title, [deck, studio.discarded]);

  const [prompt, setPrompt] = useState("");
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

  const historyQ = useQuery(trpc.idea.get.queryOptions({ ideaId: activeId ?? "" }, { enabled: dialog === "history" && Boolean(activeId) }));

  async function runGenerate(e?: FormEvent) {
    e?.preventDefault();
    if (running) return;
    const p = prompt.trim();
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
          updateStudio((s) => restoreLocally(s, idea.id, true));
          say({ text: `${idea.title} was not discarded: ${errorMessage(err)}`, tone: "bad" });
        },
      },
    );
  }

  function restore(ideaId: string) {
    // The API has no idea.restore yet: the snapshot returns to the deck locally (see concepts.ts).
    updateStudio((s) => restoreLocally(s, ideaId, false));
    say({ text: `Restored ${titleOf(ideaId) ?? "the card"} to the deck.`, tone: "good" });
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
    onEscape: () => setSelection([]),
    onContinue: goCompare,
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
          <Textarea id="ideation-prompt" aria-label="Brief" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={showHero ? 4 : 2} maxLength={4000} placeholder={`Leave empty to ${SURPRISE}.`} disabled={busy} autoGrow className={showHero ? "min-h-20" : "min-h-14"} />
          <div className="flex flex-wrap items-center gap-2">
            <SimpleSelect aria-label="Archetype hint" value={archetypeHint} onValueChange={setArchetypeHint} options={ARCHETYPE_OPTIONS} controlSize="sm" className="w-52" disabled={busy} />
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
              <p className="min-w-0 flex-1 text-small text-secondary">Leave the brief empty and the Ideation agent drafts within your profile alone.</p>
            )}
            <GenerateControl
              type="submit"
              label={prompt.trim() ? "Draft concepts" : "Surprise me within my constraints"}
              runningLabel="Drafting concepts"
              running={busy}
              progress={busy && runTotal ? runDrafted / runTotal : undefined}
              count={busy && runTotal ? `${runDrafted} of ${runTotal}${run?.total === null ? "+" : ""}` : undefined}
              onStop={draft.stop}
              kbd={`${modKey} ↵`}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              data-testid="generate-button"
              wrapperClassName="ml-auto"
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
                    <div className="text-small text-secondary">Discarded {new Date(discardedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                  </div>
                  <Button size="sm" icon={RotateCcw} onClick={() => restore(idea.id)} data-testid="restore-button">
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
                <span className="ml-auto flex items-center gap-2 text-small text-secondary">
                  Tick 2–4 cards, then <Kbd>Space</Kbd> or Compare · <Kbd>Esc</Kbd> clears
                </span>
              </div>
            ) : null}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-gutter" data-testid="concept-grid" data-count={deck.length} aria-busy={busy || undefined}>
              {entries.map((entry) =>
                entry.kind === "placeholder" ? (
                  <DraftingCard key={`slot-${entry.slot.index}`} slot={entry.slot} />
                ) : (
                  <DeckCard key={entry.idea.id} idea={entry.idea} fresh={entry.fresh} dimmed={busy && !entry.fresh} selected={selection.includes(entry.idea.id)} shortlisted={studio.shortlist.includes(entry.idea.id)} onToggleSelect={toggleSelect} onAction={stableOnAction} onOpenHistory={stableOpenHistory} />
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
        error={ask.error ? errorMessage(ask.error) : askDeskQ.error ? errorMessage(askDeskQ.error) : null}
      />
      <ForkDialog idea={active} open={dialog === "fork"} onOpenChange={(o) => !o && setDialog(null)} onFork={(input) => active && fork.mutate({ ideaId: active.id, ...input })} busy={fork.isPending} error={fork.error ? errorMessage(fork.error) : null} />
      <MergeDialog source={active} candidates={deck} preselected={selection} open={dialog === "merge"} onOpenChange={(o) => !o && setDialog(null)} onMerge={(input) => merge.mutate(input)} busy={merge.isPending} error={merge.error ? errorMessage(merge.error) : null} />
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
}

/** One card of the deck. Memoised: the brand colours and ten attribute bars are only recomputed when the idea changes. */
const DeckCard = memo(function DeckCard({ idea, fresh, dimmed, selected, shortlisted, onToggleSelect, onAction, onOpenHistory }: DeckCardProps) {
  const concept = useMemo(() => toConcept(idea), [idea]);
  return (
    <div className={cn("relative transition-opacity duration-micro", dimmed && "opacity-60")} id={`concept-${idea.id}`} data-fresh={fresh || undefined}>
      <ConceptCard concept={concept} className={cn("w-full", fresh && landedCardClass({ justIn: true }))} shortlisted={shortlisted} selected={selected} onToggleSelect={onToggleSelect} onAction={onAction} />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Tooltip content="Every version of this card">
          <Button size="sm" variant="ghost" icon={History} onClick={() => onOpenHistory(idea.id)} data-testid="history-button">
            History{concept.version && concept.version > 1 ? ` · v${concept.version}` : ""}
          </Button>
        </Tooltip>
        {fresh ? <JustInTag /> : null}
        <LinkButton size="sm" variant="default" iconRight={ArrowRight} className="ml-auto" href={commitHref(idea.id)} data-testid="commit-link">
          Commit
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
