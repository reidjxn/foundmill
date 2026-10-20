"use client";
/**
 * The Ideation Studio's dialogs (BUILD §11.1 actions, AC-11.1.3): Ask a question, "Draft a variant" (the API's fork),
 * Merge and the version History.
 * Each is a controlled Dialog; the studio owns the mutations and passes `busy` / `error` in.
 */
import { ArrowLeft, ArrowRight, GitFork, GitMerge, History, MessageCircleQuestionMark } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { RETRY_REPLY_ID, deskFailureOf, failureQuickReplies, failureReply } from "@/components/conversation/logic";
import { AgentDesk, Button, Checkbox, Chip, BusinessLogo, ConceptCard, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Markdown, SkeletonText, StatusPill, Textarea, cn, currentQuickReplies, stripEntityMarkup, useFormatters, type DeskMessage, type DeskPersona, type QuickReplyItem } from "@foundmill/dugout";
import { qaBubbles, qaOf, toConcept, versionActionLabel, versionToConcept, type IdeaLike, type IdeaVersionLike } from "./concepts";

/* ---------- Ask ---------- */

/** The Research agent as the desk shows it (`idea.askDesk` / `idea.ask`); Ideation has no business, so no department. */
export interface AskPersona {
  name: string;
  role: string;
  avatarSeed: string;
  voice?: { greeting?: string | null; thinking?: readonly string[]; ack?: readonly string[] } | null;
  thinkingLine?: string | null;
}

/** One answered exchange of this sheet's session (the founder's words, the reply, the version it created). */
export interface AskExchange {
  id: string;
  question: string;
  bubbles: readonly string[];
  quickReplies: readonly QuickReplyItem[];
  reaction?: string | null;
  at: Date;
  /** "Saved as version 4"; plus any attribute the version moved. */
  version?: number | null;
  changes?: readonly { key: string; label: string; from: number; to: number }[];
}

/** What the founder asked: a starter or quick reply (by id, when the server issued it), or typed words. */
export type AskInput = { quickReplyId: string; say: string } | { question: string };

export interface AskSheetProps {
  idea: IdeaLike | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persona: AskPersona | null;
  starters: readonly QuickReplyItem[];
  /** Ask; resolves when the answer has arrived (the Write field clears then), rejects when it failed. */
  onAsk: (input: AskInput) => Promise<unknown>;
  /** This session's answered exchanges, newest last (earlier ones come from the card's history). */
  exchanges: readonly AskExchange[];
  busy?: boolean;
  error?: string | null;
}

const RESEARCH_DEPT = "dept-1" as const;

/** The stored history of a card's Ask, as desk messages (one founder bubble, then the agent's bubbles). */
export function askHistory(idea: IdeaLike | null): DeskMessage[] {
  if (!idea) return [];
  const at = idea.current?.createdAt ?? new Date(0);
  return qaOf(idea).flatMap((qa, i) => [
    { id: `qa-${i}-q`, author: "founder" as const, bubbles: [qa.question], at, state: "seen" as const },
    { id: `qa-${i}-a`, author: "agent" as const, bubbles: qaBubbles(qa), at, quickReplies: (qa.quick_replies ?? []) as QuickReplyItem[], reaction: (qa.reaction as DeskMessage["reaction"]) ?? null },
  ]);
}

/**
 * Ask on a concept (audit-conversation §4): the Research agent's desk as a sheet beside the deck. Starters are buttons,
 * every answer comes with 2–4 quick replies, typing is optional (Write). Each answer is a new version of the card; the
 * line under the band says which, and any rating it moved. When an answer does not come back (the api is down, the
 * model failed, a limit), the founder's words stay ("Not sent") and the Research agent says so itself, with "Try again"
 * first among the replies.
 */
export function AskDialog({ idea, open, onOpenChange, persona, starters, onAsk, exchanges, busy, error }: AskSheetProps) {
  // The card's history as it was when the sheet opened; answers of this session follow it (never shown twice).
  const [history, setHistory] = useState<DeskMessage[]>([]);
  const [pending, setPending] = useState<{ id: string; words: string; failed: boolean; input: AskInput } | null>(null);
  // Why the pending question failed, in the Research agent's own words (never stored).
  const [failure, setFailure] = useState<{ bubbles: string[]; retry: boolean; at: Date } | null>(null);
  useEffect(() => {
    if (open) setHistory(askHistory(idea));
    else {
      setPending(null);
      setFailure(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot once per opening
  }, [open, idea?.id]);

  // One question at a time (a double press, a key held down): the ref answers before React does.
  const inFlight = useRef(false);
  const ask = useCallback(
    async (input: AskInput, words: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const id = `ask-${Date.now().toString(36)}`;
      setFailure(null);
      setPending({ id, words, failed: false, input });
      try {
        await onAsk(input);
        setPending(null);
      } catch (err) {
        const f = deskFailureOf(err);
        setFailure({ ...failureReply(f.kind, f.message), at: new Date() });
        setPending((p) => (p && p.id === id ? { ...p, failed: true } : p));
        throw err;
      } finally {
        inFlight.current = false;
      }
    },
    [onAsk],
  );

  const messages = useMemo<DeskMessage[]>(() => {
    const session = exchanges.flatMap((x) => [
      { id: `${x.id}-q`, author: "founder" as const, bubbles: [x.question], at: x.at, state: "seen" as const },
      { id: `${x.id}-a`, author: "agent" as const, bubbles: x.bubbles, at: x.at, quickReplies: x.quickReplies, reaction: (x.reaction as DeskMessage["reaction"]) ?? null },
    ]);
    const before = [...history, ...session];
    const tail: DeskMessage[] = pending ? [{ id: pending.id, author: "founder", bubbles: [pending.words], at: new Date(), state: pending.failed ? "failed" : "sending" }] : [];
    if (pending?.failed && failure) {
      const failedId = "quickReplyId" in pending.input ? pending.input.quickReplyId : null;
      tail.push({ id: `${pending.id}-failure`, author: "agent", bubbles: failure.bubbles, at: failure.at, reaction: "concerned", quickReplies: failureQuickReplies(failure.retry, currentQuickReplies(before, starters), failedId) });
    }
    return [...before, ...tail];
  }, [history, exchanges, pending, failure, starters]);

  const latest = exchanges[exchanges.length - 1];
  const name = idea?.current?.title ?? idea?.title ?? "this concept";
  const subjectLine = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="ask-subject">
      <span>
        About <span className="text-primary">{name}</span>. Every answer is saved to the card's history.
      </span>
      {latest?.version ? (
        <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="ask-version">
          <Chip icon={History}>Saved as version {latest.version}</Chip>
          {(latest.changes ?? []).map((c) => (
            <Chip key={c.key} tone={c.to > c.from ? "good" : "warn"}>
              {c.label} {c.from} → {c.to}
            </Chip>
          ))}
        </span>
      ) : null}
      {error && !pending?.failed ? (
        <StatusPill tone="bad" role="alert">
          {error}
        </StatusPill>
      ) : null}
    </span>
  );

  if (!idea) return null;
  const deskPersona: DeskPersona = persona
    ? { id: `research-${idea.id}`, name: persona.name, role: persona.role, avatarSeed: persona.avatarSeed, dept: RESEARCH_DEPT, presence: "available", voice: persona.voice ?? null, thinkingLine: persona.thinkingLine ?? null }
    : { id: `research-${idea.id}`, name: "Research agent", role: "Grounds concepts with evidence", avatarSeed: "research-agent", dept: RESEARCH_DEPT, presence: "available" };

  return (
    <AgentDesk
      variant="sheet"
      testId="ask-dialog"
      label={`Ask the Research agent about ${name}`}
      open={open}
      onOpenChange={onOpenChange}
      persona={deskPersona}
      messages={messages}
      starters={starters}
      replying={busy}
      thinkingPhrase={`reading ${name}'s card`}
      pendingReplyId={pending && !pending.failed && "quickReplyId" in pending.input ? pending.input.quickReplyId : null}
      // Ideation runs before any business exists: there are no records to mention, so no `[[ent:…]]` becomes a link,
      // whoever wrote it (audit FR-23). The markup shows as its plain name.
      renderBubble={(md) => <Markdown variant="body" entities={false}>{stripEntityMarkup(md)}</Markdown>}
      onQuickReply={(r) => {
        // "Try again" resends the kept question as it was; anything else is a new question.
        if (r.id === RETRY_REPLY_ID) return void (pending && ask(pending.input, pending.words).catch(() => undefined));
        void ask({ quickReplyId: r.id, say: r.say?.trim() || r.label }, r.say?.trim() || r.label).catch(() => undefined);
      }}
      onSend={(text) => ask({ question: text }, text)}
      disabled={!persona}
      disabledNote={!persona ? <span aria-busy="true">Opening the Research agent's desk…</span> : undefined}
      subject={subjectLine}
    />
  );
}

/* ---------- Fork ---------- */

export interface ForkDialogProps {
  idea: IdeaLike | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFork: (input: { title: string; pitch: string }) => void;
  busy?: boolean;
  error?: string | null;
}

/**
 * "More like this" on a card: a variant with its own history (the API's `idea.fork`; the founder never reads "fork",
 * A14). The default name carries "(variant)", which Commit drops from the business name.
 */
export function ForkDialog({ idea, open, onOpenChange, onFork, busy, error }: ForkDialogProps) {
  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");
  useEffect(() => {
    if (open && idea) {
      setTitle(`${idea.current?.title ?? idea.title} (variant)`.slice(0, 120));
      setPitch(idea.current?.pitch ?? idea.pitch);
    }
  }, [open, idea]);
  const valid = title.trim().length > 0 && title.trim().length <= 120 && pitch.length <= 4000;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    onFork({ title: title.trim(), pitch });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" aria-describedby="fork-description" data-testid="fork-dialog">
        <DialogHeader>
          <DialogTitle>Draft a variant of {idea?.title ?? "this concept"}</DialogTitle>
          <DialogDescription id="fork-description">A variant is a new card with its own history. The original keeps a "Forked" entry in its history pointing at it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="flex flex-col gap-3">
            <Field htmlFor="fork-title" label="Name" required>
              <Input id="fork-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
            </Field>
            <Field htmlFor="fork-pitch" label="Pitch" hint="Change the angle, the audience or the mechanism. The ratings carry over; ask the Research agent to check them again.">
              <Textarea id="fork-pitch" value={pitch} onChange={(e) => setPitch(e.target.value)} rows={5} maxLength={4000} />
            </Field>
            {error ? (
              <StatusPill tone="bad" role="alert">
                {error}
              </StatusPill>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" icon={GitFork} loading={busy} disabled={!valid}>
              Draft it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Merge ---------- */

export interface MergeDialogProps {
  /** The card the merge started from. */
  source: IdeaLike | null;
  /** Other cards in the deck to merge with. */
  candidates: IdeaLike[];
  /** Pre-ticked ids (the Compare selection, say). */
  preselected?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerge: (input: { ideaIds: string[]; title?: string }) => void;
  busy?: boolean;
  error?: string | null;
}

export const MERGE_MAX = 4;

export function MergeDialog({ source, candidates, preselected = [], open, onOpenChange, onMerge, busy, error }: MergeDialogProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (open) {
      setPicked(preselected.filter((id) => id !== source?.id).slice(0, MERGE_MAX - 1));
      setTitle("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, source?.id]);
  const others = useMemo(() => candidates.filter((c) => c.id !== source?.id), [candidates, source?.id]);
  const ids = source ? [source.id, ...picked] : picked;
  const valid = ids.length >= 2 && ids.length <= MERGE_MAX;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MERGE_MAX - 1 ? [...p, id] : p));
  const suggested = [source, ...others.filter((o) => picked.includes(o.id))]
    .filter((x): x is IdeaLike => Boolean(x))
    .map((x) => x.title)
    .join(" × ");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" aria-describedby="merge-description" data-testid="merge-dialog">
        <DialogHeader>
          <DialogTitle>Merge {source?.title ?? "concepts"}</DialogTitle>
          <DialogDescription id="merge-description">Pick one to three more cards. The merged card averages their attributes and keeps every citation; the sources get a "merged" version.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {others.length === 0 ? (
            <p className="text-body text-secondary">Generate or restore another card to merge with.</p>
          ) : (
            <ul className="flex flex-col gap-1.5" aria-label="Cards to merge with">
              {others.map((c) => {
                const concept = toConcept(c);
                const checked = picked.includes(c.id);
                const full = !checked && picked.length >= MERGE_MAX - 1;
                return (
                  <li key={c.id}>
                    <label className={cn("flex cursor-pointer items-center gap-3 rounded-panel border border-subtle bg-panel-alt p-2 hover:border-secondary/50", checked && "border-link", full && "cursor-not-allowed opacity-50")} data-merge-candidate={c.id}>
                      <Checkbox checked={checked} disabled={full} onCheckedChange={() => toggle(c.id)} aria-label={`Merge with ${c.title}`} />
                      <BusinessLogo name={concept.name} primary={concept.kit.primary} size={32} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-body-strong">{concept.name}</div>
                        <div className="truncate text-small text-secondary">{concept.pitch}</div>
                      </div>
                      {concept.archetypeLabel ? <Chip>{concept.archetypeLabel}</Chip> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <Field htmlFor="merge-title" label="Name for the merged card" hint={suggested ? `Leave empty for "${suggested}".` : undefined}>
            <Input id="merge-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={suggested || "Merged concept"} />
          </Field>
          {error ? (
            <StatusPill tone="bad" role="alert">
              {error}
            </StatusPill>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto text-small text-secondary tabular-nums">
            {ids.length} of {MERGE_MAX} cards
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon={GitMerge} loading={busy} disabled={!valid} onClick={() => onMerge({ ideaIds: ids, title: title.trim() || undefined })}>
            Merge {ids.length >= 2 ? `${ids.length} cards` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- History ---------- */

export interface HistoryDialogProps {
  idea: IdeaLike | null;
  versions: IdeaVersionLike[] | undefined;
  loading?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump to another card (merge/fork lineage). */
  onOpenIdea?: (ideaId: string) => void;
  lineage?: { mergedFrom: string[]; mergedInto: string | null; forkedFrom: string | null; forkedTo: string | null };
  titleOf?: (ideaId: string) => string | undefined;
}

/** Every version of a card, newest first, with a stepper and the card as it looked then (AC-11.1.3: history navigable). */
export function HistoryDialog({ idea, versions, loading, open, onOpenChange, onOpenIdea, lineage, titleOf }: HistoryDialogProps) {
  const { formatDateTime } = useFormatters();
  const ordered = useMemo(() => [...(versions ?? [])].sort((a, b) => b.version - a.version), [versions]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (open) setIndex(0);
  }, [open, idea?.id]);
  const shown = ordered[index];
  const linkOf = (id: string) => titleOf?.(id) ?? `${id.slice(0, 8)}…`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" aria-describedby="history-description" data-testid="history-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History size={16} aria-hidden /> History of {idea?.title ?? "concept"}
          </DialogTitle>
          <DialogDescription id="history-description">Every action creates a version. Step through them; the card on the right is the version as it was.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loading || !idea ? (
            <SkeletonText lines={4} />
          ) : ordered.length === 0 ? (
            <p className="text-body text-secondary">No versions recorded yet.</p>
          ) : (
            <div className="grid grid-cols-[minmax(280px,1fr)_auto] gap-gutter">
              <div className="flex flex-col gap-3">
                <ol className="flex flex-col divide-y divide-subtle/50 rounded-panel border border-subtle" aria-label="Versions">
                  {ordered.map((v, i) => (
                    <li key={v.id}>
                      <button type="button" onClick={() => setIndex(i)} aria-current={i === index ? "true" : undefined} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/4", i === index && "bg-panel-alt")} data-version={v.version}>
                        <Chip>Version {v.version}</Chip>
                        <span className="text-body-strong">{versionActionLabel(v.action)}</span>
                        <span className="ml-auto text-small text-secondary tabular-nums">{formatDateTime(v.createdAt)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                {lineage && (lineage.mergedFrom.length > 0 || lineage.mergedInto || lineage.forkedFrom || lineage.forkedTo) ? (
                  <div className="rounded-panel border border-subtle bg-panel-alt p-3" data-testid="lineage">
                    <div className="t-label mb-1.5">Lineage</div>
                    <ul className="flex flex-col gap-1 text-body">
                      {lineage.forkedFrom ? (
                        <li>
                          Forked from <LineageLink id={lineage.forkedFrom} label={linkOf(lineage.forkedFrom)} onOpen={onOpenIdea} />
                        </li>
                      ) : null}
                      {lineage.forkedTo ? (
                        <li>
                          Forked to <LineageLink id={lineage.forkedTo} label={linkOf(lineage.forkedTo)} onOpen={onOpenIdea} />
                        </li>
                      ) : null}
                      {lineage.mergedFrom.length ? (
                        <li>
                          Merged from{" "}
                          {lineage.mergedFrom.map((id, i) => (
                            <span key={id}>
                              {i > 0 ? ", " : ""}
                              <LineageLink id={id} label={linkOf(id)} onOpen={onOpenIdea} />
                            </span>
                          ))}
                        </li>
                      ) : null}
                      {lineage.mergedInto ? (
                        <li>
                          Merged into <LineageLink id={lineage.mergedInto} label={linkOf(lineage.mergedInto)} onOpen={onOpenIdea} />
                        </li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="default" icon={ArrowLeft} disabled={index >= ordered.length - 1} onClick={() => setIndex((i) => Math.min(ordered.length - 1, i + 1))}>
                    Older
                  </Button>
                  <Button size="sm" variant="default" iconRight={ArrowRight} disabled={index <= 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
                    Newer
                  </Button>
                  <span className="ml-auto text-small text-secondary tabular-nums">
                    {ordered.length - index} of {ordered.length}
                  </span>
                </div>
              </div>
              {shown ? <ConceptCard concept={versionToConcept(idea, shown)} hideActions /> : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LineageLink({ id, label, onOpen }: { id: string; label: string; onOpen?: (id: string) => void }) {
  if (!onOpen) return <span className="font-mono text-mono">{label}</span>;
  return (
    <button type="button" className="text-link hover:underline" onClick={() => onOpen(id)} data-lineage-link={id}>
      {label}
    </button>
  );
}

export const ASK_ICON = MessageCircleQuestionMark;
