"use client";
/**
 * The Ideation Studio's dialogs (BUILD §11.1 actions, AC-11.1.3): Ask a question, Fork, Merge and the version History.
 * Each is a controlled Dialog; the studio owns the mutations and passes `busy` / `error` in.
 */
import { ArrowLeft, ArrowRight, GitFork, GitMerge, History, MessageCircleQuestionMark, Send } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Checkbox, Chip, ConceptCard, Crest, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Markdown, SkeletonText, StatusPill, Textarea, cn, formatDateTime, initials } from "@foundmill/dugout";
import { qaOf, toConcept, versionActionLabel, versionToConcept, type IdeaLike, type IdeaVersionLike } from "./concepts";

/* ---------- Ask ---------- */

export interface AskDialogProps {
  idea: IdeaLike | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAsk: (question: string) => void;
  busy?: boolean;
  error?: string | null;
  /** The latest answer, shown under the thread once it arrives. */
  answer?: string | null;
}

export function AskDialog({ idea, open, onOpenChange, onAsk, busy, error, answer }: AskDialogProps) {
  const [question, setQuestion] = useState("");
  useEffect(() => {
    if (!open) setQuestion("");
  }, [open]);
  const thread = idea ? qaOf(idea) : [];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim().length === 0 || busy) return;
    onAsk(question.trim());
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" aria-describedby="ask-description" data-testid="ask-dialog">
        <DialogHeader>
          <DialogTitle>Ask about {idea?.title ?? "this concept"}</DialogTitle>
          <DialogDescription id="ask-description">The Research agent answers from the concept's evidence. Attribute changes it can justify become a new version.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {thread.length > 0 ? (
            <ol className="flex flex-col gap-2" aria-label="Earlier questions">
              {thread.map((qa, i) => (
                <li key={i} className="rounded-panel border border-subtle bg-panel-alt p-3">
                  <p className="text-body-strong">{qa.question}</p>
                  <Markdown variant="body" className="mt-1 text-secondary">
                    {qa.answer}
                  </Markdown>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-body text-secondary">No questions yet. Try "Who are the two closest competitors?" or "What would the first paying customer look like?"</p>
          )}
          {busy ? (
            <div className="rounded-panel border border-subtle bg-panel-alt p-3" aria-busy="true" aria-label="Researching">
              <SkeletonText lines={3} />
            </div>
          ) : answer ? (
            <div className="rounded-panel border border-link/40 bg-panel-alt p-3" data-testid="ask-answer">
              <Markdown variant="body">{answer}</Markdown>
            </div>
          ) : null}
          <form onSubmit={submit} className="flex flex-col gap-2" data-testid="ask-form">
            <Field htmlFor="ask-question" label="Your question">
              <Textarea id="ask-question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} maxLength={2000} placeholder="Ask anything the card leaves open" autoFocus />
            </Field>
            {error ? (
              <StatusPill tone="bad" role="alert">
                {error}
              </StatusPill>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="primary" icon={Send} loading={busy} disabled={question.trim().length === 0} onClick={submit}>
            Ask
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

export function ForkDialog({ idea, open, onOpenChange, onFork, busy, error }: ForkDialogProps) {
  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");
  useEffect(() => {
    if (open && idea) {
      setTitle(`${idea.current?.title ?? idea.title} (fork)`.slice(0, 120));
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
          <DialogTitle>Fork {idea?.title ?? "concept"}</DialogTitle>
          <DialogDescription id="fork-description">A fork is a new card with its own history. The original keeps a "forked" version pointing at it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="flex flex-col gap-3">
            <Field htmlFor="fork-title" label="Name" required>
              <Input id="fork-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} autoFocus />
            </Field>
            <Field htmlFor="fork-pitch" label="Pitch" hint="Change the angle, the audience or the mechanism. Attributes carry over and the Research agent re-grounds them on Ask.">
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
              Create fork
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
                      <Crest seed={concept.crestSeed} kitPrimary={concept.kit.primary} kitSecondary={concept.kit.secondary} monogram={initials(concept.name)} size={32} title={`${concept.name} logo`} />
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
                        <Chip mono>v{v.version}</Chip>
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
