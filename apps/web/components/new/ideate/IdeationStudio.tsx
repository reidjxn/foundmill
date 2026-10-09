"use client";
/**
 * /new/ideate — the Ideation Studio (BUILD §11.1 Door A; AC-11.1.2, AC-11.1.3). Prompt box ("surprise me within my
 * constraints" when empty) → idea.draft, streamed (audit P2): the concepts are named as the slate arrives and each card
 * fills its place the moment it is saved, with who is drafting, a live progress line, the elapsed time and a Stop button;
 * existing cards stay visible (dimmed) meanwhile. Cards are 6–12 ConceptCards (Dugout profile cards: the initials mark
 * until a logo is chosen at Commit, stars, ten AttributeBars with evidence hover, citation count). Actions: Shortlist
 * (local), Merge / Fork / Ask (idea.*, each a new version), Discard (idea.discard; reversible from the tray). Select 2–4
 * cards → Compare. History opens every version. ⌘/Ctrl+Enter drafts from anywhere on the page.
 *
 * Ideation is private: no business exists yet, so there is no kit bar and nothing reaches LIVE.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Bookmark, Columns3, History, RotateCcw, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ARCHETYPES, ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared";
import { Button, Chip, BusinessLogo, ConceptCard, EmptyState, IconButton, Kbd, Panel, SimpleSelect, Skeleton, SkeletonText, StatusPill, Textarea, Tooltip, cn, useToast, type ConceptAction } from "@foundmill/dugout";
import { useKeyboardMap } from "@/lib/keys";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { LinkButton } from "../LinkButton";
import { StudioFrame } from "../StudioFrame";
import { COMPARE_MAX, COMPARE_MIN, buildDeck, commitHref, compareHref, costLabel, discardLocally, lineageOf, orderDeck, restoreLocally, toConcept, toggleSelection, type IdeaLike } from "./concepts";
import { AskDialog, ForkDialog, HistoryDialog, MergeDialog } from "./dialogs";
import { DraftStatus, DraftingCard } from "./DraftStatus";
import { formatElapsed, gridEntries, prependIdea } from "./draft-run";
import { useDraftRun } from "./use-draft-run";
import { useStudioState } from "./use-studio-state";

export interface IdeationStudioProps {
  viewer: { email: string | null };
  profileLine?: string | null;
  /** The founder's constraint chips, echoed next to "surprise me". */
  constraints?: string[];
}

const SURPRISE = "surprise me within my constraints";

type DraftInput = { prompt: string; archetypeHint?: Archetype };
const ARCHETYPE_OPTIONS = [{ value: "any", label: "Any archetype" }, ...ARCHETYPES.map((a) => ({ value: a, label: ARCHETYPE_LABELS[a] }))];

type DialogKind = "ask" | "fork" | "merge" | "history" | null;

export function IdeationStudio({ viewer, profileLine, constraints = [] }: IdeationStudioProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const userKey = viewer.email ?? "dev";
  const [studio, updateStudio, hydrated] = useStudioState(userKey);

  const ideasQ = useQuery(trpc.idea.list.queryOptions({ limit: 100 }, { staleTime: 10_000 }));
  const serverIdeas = useMemo<IdeaLike[]>(() => ideasQ.data?.items ?? [], [ideasQ.data]);
  const deck = useMemo(() => orderDeck(buildDeck(serverIdeas, studio), studio.shortlist), [serverIdeas, studio]);
  const titleOf = useCallback((id: string) => [...deck, ...studio.discarded.map((d) => d.idea)].find((i) => i.id === id)?.title, [deck, studio.discarded]);

  const [prompt, setPrompt] = useState("");
  const [archetypeHint, setArchetypeHint] = useState<string>("any");
  const [selection, setSelection] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (hydrated && studio.lastPrompt && !prompt) setPrompt(studio.lastPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed the prompt once after hydration
  }, [hydrated]);

  const active = useMemo(() => deck.find((i) => i.id === activeId) ?? null, [deck, activeId]);
  const invalidateIdeas = () => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("idea") as unknown[] });

  const client = useTRPCClient();
  const listKey = trpc.idea.list.queryKey({ limit: 100 });
  const draft = useDraftRun((input: DraftInput, signal) => client.idea.draft.mutate(input, { signal }), {
    // Each saved card goes straight into the deck's cache: no refetch of the whole list.
    onIdea: (idea) => queryClient.setQueryData(listKey, (old) => prependIdea(old, idea)),
    onDone: (event) => toast({ title: `${event.ideas.length} concepts drafted`, description: `In ${formatElapsed(event.elapsedMs)} · model cost ${costLabel(event.costMinor)} · ${event.costLabel}${event.mode === "mock" ? " · mock mode" : ""}`, tone: "good" }),
    onError: (err) => toast({ title: "Draft stopped early", description: errorMessage(err), tone: "bad" }),
    onStop: () => {
      // A card saved in the last instant may not have reached the stream: read the deck once more.
      void queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Draft stopped", description: "Concepts already drafted stay in your deck.", tone: "neutral" });
    },
  });
  const { run, running } = draft;

  const merge = useMutation(
    trpc.idea.merge.mutationOptions({
      onSuccess: async (merged) => {
        await invalidateIdeas();
        setDialog(null);
        setSelection([]);
        toast({ title: "Merged", description: `${merged.title} is a new card; the sources keep a "merged" version.`, tone: "good" });
      },
    }),
  );
  const fork = useMutation(
    trpc.idea.fork.mutationOptions({
      onSuccess: async (forked) => {
        await invalidateIdeas();
        setDialog(null);
        toast({ title: "Forked", description: `${forked.title} has its own history now.`, tone: "good" });
      },
    }),
  );
  const ask = useMutation(
    trpc.idea.ask.mutationOptions({
      onSuccess: async (res) => {
        await invalidateIdeas();
        setLastAnswer(res.answer);
      },
    }),
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
    setLastAnswer(null);
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
        onSuccess: () => toast({ title: "Discarded", description: `${idea.title} is in the tray. Nothing is deleted.`, tone: "neutral", action: { label: "Undo", onClick: () => restore(idea.id) } }),
        onError: (err) => {
          updateStudio((s) => restoreLocally(s, idea.id, true));
          toast({ title: "Not discarded", description: errorMessage(err), tone: "bad" });
        },
      },
    );
  }

  function restore(ideaId: string) {
    // The API has no idea.restore yet: the snapshot returns to the deck locally (see concepts.ts).
    updateStudio((s) => restoreLocally(s, ideaId, false));
    toast({ title: "Restored", description: "Back in the deck.", tone: "good" });
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
      <form onSubmit={runGenerate} className={cn("surface-panel mb-gutter overflow-hidden", showHero && "mx-auto max-w-[960px]")} data-testid="prompt-box">
        <div className="flex h-panel-header items-center gap-2 border-b border-subtle bg-panel-alt px-panel-pad">
          <Sparkles size={14} className="text-secondary" aria-hidden />
          <span className="t-label">Brief for the Ideation agent</span>
          <span className="ml-auto text-small text-secondary">Private · nothing reaches LIVE</span>
        </div>
        <div className={cn("flex flex-col gap-3 p-panel-pad", showHero && "p-5")}>
          {showHero ? (
            <div className="mb-1">
              <h2 className="t-display-lg">What should exist that does not yet?</h2>
              <p className="mt-1 max-w-[640px] text-body text-secondary">A concept, a problem, a market, or nothing at all. The Ideation agent drafts six to twelve cards; the Research agent grounds each with competitors, market size and pricing comparables.</p>
            </div>
          ) : null}
          <Textarea id="ideation-prompt" aria-label="Brief" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={showHero ? 4 : 2} maxLength={4000} placeholder={`Leave empty to ${SURPRISE}.`} disabled={busy} autoGrow />
          <div className="flex flex-wrap items-center gap-2">
            <SimpleSelect aria-label="Archetype hint" value={archetypeHint} onValueChange={setArchetypeHint} options={ARCHETYPE_OPTIONS} controlSize="sm" className="w-52" disabled={busy} />
            {constraints.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Your constraints">
                <span className="text-small text-secondary">Within:</span>
                {constraints.slice(0, 4).map((c) => (
                  <Chip key={c}>{c}</Chip>
                ))}
                {constraints.length > 4 ? <Chip>+{constraints.length - 4}</Chip> : null}
              </div>
            ) : null}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-small text-secondary tabular-nums">{prompt.length}/4000</span>
              <span className="flex items-center gap-1 text-small text-secondary" aria-hidden>
                <Kbd>{modKey}</Kbd>
                <Kbd>Enter</Kbd>
              </span>
              <Button type="submit" variant="primary" size="lg" className="normal-case tracking-normal text-body" icon={prompt.trim() ? Sparkles : Wand2} loading={busy} aria-keyshortcuts="Meta+Enter Control+Enter" data-testid="generate-button">
                {prompt.trim() ? "Draft concepts" : "Surprise me"}
              </Button>
            </div>
          </div>
          {run && run.status === "failed" ? (
            <StatusPill tone="bad" role="alert">
              {run.error}
            </StatusPill>
          ) : null}
        </div>
      </form>

      {run ? <DraftStatus run={run} onStop={draft.stop} /> : null}

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
            {deck.length > 0 ? (
              <div className="mb-3 flex items-center gap-3">
                <span className="t-label">{deck.length} concepts</span>
                {studio.shortlist.length > 0 ? (
                  <Chip icon={Bookmark} tone="kit">
                    {studio.shortlist.filter((id) => deck.some((d) => d.id === id)).length} shortlisted
                  </Chip>
                ) : null}
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
            {showHero ? (
              <EmptyState icon={Sparkles} title="No concepts yet" className="mt-gutter">
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

      <AskDialog idea={active} open={dialog === "ask"} onOpenChange={(o) => !o && setDialog(null)} onAsk={(question) => active && ask.mutate({ ideaId: active.id, question })} busy={ask.isPending} error={ask.error ? errorMessage(ask.error) : null} answer={lastAnswer} />
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
      <ConceptCard concept={concept} className="w-full" shortlisted={shortlisted} selected={selected} onToggleSelect={onToggleSelect} onAction={onAction} />
      <div className="mt-1.5 flex items-center gap-1.5">
        <Tooltip content="Every version of this card">
          <Button size="sm" variant="ghost" icon={History} onClick={() => onOpenHistory(idea.id)} data-testid="history-button">
            History{concept.version && concept.version > 1 ? ` · v${concept.version}` : ""}
          </Button>
        </Tooltip>
        <LinkButton size="sm" variant="default" iconRight={ArrowRight} className="ml-auto" href={commitHref(idea.id)} data-testid="commit-link">
          Commit
        </LinkButton>
      </div>
    </div>
  );
});

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
