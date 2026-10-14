"use client";
/**
 * Training › Custom skills (BUILD §11.10 "Custom skills: founder adds name + description + optional examples; Opus
 * drafts a test set; founder reviews before it counts"). Add skill opens a form (`agent.skills.createCustom`: an Opus
 * call, its cost an Estimate); the drafted tests open for review at once, and the founder keeps the ones that measure
 * the skill (`agent.skills.review`) or discards the skill (`agent.skills.discard`). Held-out tests are never shown
 * (AC-11.10.2), only counted. A reviewed skill joins the agent's skills and the next training run scores it.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button, Checkbox, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Panel, ProvenanceChip, Textarea, formatMoney, useToast } from "@foundmill/dugout";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import type { AgentProfile } from "./logic";

type CustomSkill = RouterOutputs["agent"]["skills"]["custom"][number];
type Draft = CustomSkill["drafts"][number];

/** The founder's examples, one per line (empty lines dropped, at most five). */
export function examplesFrom(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 3)
    .slice(0, 5);
}

export interface CustomSkillsPanelProps {
  businessId: string;
  profile: AgentProfile;
  onChanged: () => void;
}

export function CustomSkillsPanel({ businessId, profile, onChanged }: CustomSkillsPanelProps) {
  const trpc = useTRPC();
  const agent = profile.agent;
  const customQ = useQuery(trpc.agent.skills.custom.queryOptions({ businessId, agentId: agent.id }, { staleTime: 30_000 }));
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState<{ definitionId: string; name: string; drafts: Draft[]; heldOut: number } | null>(null);
  const skills = customQ.data ?? [];
  const released = !!agent.archivedAt;
  return (
    <>
      <Panel
        title="Custom skills"
        span={12}
        loading={customQ.isLoading}
        error={customQ.error ? errorMessage(customQ.error) : undefined}
        onRetry={() => void customQ.refetch()}
        actions={
          <Button size="sm" icon={Plus} onClick={() => setAdding(true)} disabled={released} data-testid="add-custom-skill">
            Add skill
          </Button>
        }
        empty={!customQ.isLoading && skills.length === 0 ? { icon: Sparkles, children: `Add a skill ${agent.name} needs that the catalog does not cover. Opus drafts a test set; it counts once you have reviewed it.` } : undefined}
        footer="Opus drafts the tests; half are held out and never shown, so training scores the skill blind. A skill counts once you approve its tests."
        data-testid="custom-skills"
      >
        <ul className="flex flex-col divide-y divide-line-faint">
          {skills.map((s) => (
            <li key={s.definitionId} className="flex items-start gap-3 py-2" data-skill={s.skillKey}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-body-strong text-primary">
                  {s.name}
                  {s.status === "awaiting_review" ? <Chip tone="warn">Awaiting your review</Chip> : <Chip tone="good">{`Counts · ${s.tests} ${s.tests === 1 ? "test" : "tests"}, ${s.heldOut} held out`}</Chip>}
                </span>
                <span className="line-clamp-2 text-small text-secondary">{s.description}</span>
              </span>
              {s.status === "awaiting_review" && !released ? (
                <Button size="sm" variant="primary" icon={ClipboardCheck} onClick={() => setReviewing({ definitionId: s.definitionId, name: s.name, drafts: s.drafts, heldOut: s.draftsHeldOut })} data-testid="review-custom-skill">
                  Review tests
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
      <AddSkillDialog
        businessId={businessId}
        agentId={agent.id}
        agentName={agent.name}
        open={adding}
        onOpenChange={setAdding}
        onDrafted={(r) => {
          setAdding(false);
          void customQ.refetch();
          setReviewing(r);
        }}
      />
      <ReviewTestsDialog
        businessId={businessId}
        agentId={agent.id}
        skill={reviewing}
        onOpenChange={(o) => !o && setReviewing(null)}
        onDone={() => {
          setReviewing(null);
          void customQ.refetch();
          onChanged();
        }}
      />
    </>
  );
}

function AddSkillDialog({ businessId, agentId, agentName, open, onOpenChange, onDrafted }: { businessId: string; agentId: string; agentName: string; open: boolean; onOpenChange: (open: boolean) => void; onDrafted: (r: { definitionId: string; name: string; drafts: Draft[]; heldOut: number }) => void }) {
  const id = useId();
  const trpc = useTRPC();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [examples, setExamples] = useState("");
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setExamples("");
    }
  }, [open]);
  const create = useMutation(
    trpc.agent.skills.createCustom.mutationOptions({
      onSuccess: (r, vars) => {
        toast({ title: `Tests drafted for “${vars.name}”`, description: `${r.drafts.length} to review, ${r.draftsHeldOut} held out. Drafting cost ${formatMoney({ amountMinor: r.cost.amountMinor, currency: r.cost.currency })} (Estimate).`, tone: "good" });
        onDrafted({ definitionId: r.definitionId, name: vars.name, drafts: r.drafts, heldOut: r.draftsHeldOut });
      },
    }),
  );
  const valid = name.trim().length >= 3 && description.trim().length >= 20;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" aria-describedby={`${id}-desc`} data-testid="add-skill-dialog">
        <DialogHeader>
          <DialogTitle>Add a skill to {agentName}</DialogTitle>
          <DialogDescription id={`${id}-desc`}>Name the skill and say what good looks like. Opus drafts a test set for you to review; nothing counts until you approve it.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field htmlFor={`${id}-name`} label="Skill" required>
            <Input id={`${id}-name`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Grant writing" />
          </Field>
          <Field htmlFor={`${id}-desc-input`} label="What good looks like" required hint="At least 20 characters: the situations, the inputs and what a great answer does.">
            <Textarea id={`${id}-desc-input`} rows={3} value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} placeholder="Writes grant applications for EU innovation funds: reads the call, maps it to our product and drafts each section within the word limits." />
          </Field>
          <Field htmlFor={`${id}-examples`} label="Examples (optional)" hint="One per line, up to five: an input and the output you would want.">
            <Textarea id={`${id}-examples`} rows={3} value={examples} onChange={(e) => setExamples(e.target.value)} placeholder="Call: Horizon EIC Accelerator => a 300-word excellence section that cites the call's criteria" />
          </Field>
          <p className="inline-flex items-center gap-1.5 text-small text-secondary">
            Drafting is one Opus call charged to credits <ProvenanceChip kind="estimate" />
          </p>
          {create.error ? (
            <p role="alert" className="text-small text-status-bad">
              {errorMessage(create.error)}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="generate" icon={Sparkles} disabled={!valid} loading={create.isPending} onClick={() => create.mutate({ businessId, agentId, name: name.trim(), description: description.trim(), examples: examplesFrom(examples) })} data-testid="draft-custom-skill">
            Draft tests
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewTestsDialog({ businessId, agentId, skill, onOpenChange, onDone }: { businessId: string; agentId: string; skill: { definitionId: string; name: string; drafts: Draft[]; heldOut: number } | null; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const id = useId();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [keep, setKeep] = useState<string[]>([]);
  useEffect(() => setKeep(skill?.drafts.map((d) => d.id) ?? []), [skill]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpcPathPrefix("agent") as unknown[] });
  const review = useMutation(
    trpc.agent.skills.review.mutationOptions({
      onSuccess: (r) => {
        toast({ title: `“${skill?.name ?? "The skill"}” counts now`, description: `${r.reviewed} tests kept${r.dropped ? `, ${r.dropped} dropped` : ""}. Train the agent to score it.`, tone: "good" });
        void invalidate();
        onDone();
      },
    }),
  );
  const discard = useMutation(
    trpc.agent.skills.discard.mutationOptions({
      onSuccess: () => {
        toast({ title: `“${skill?.name ?? "The skill"}” discarded`, tone: "info" });
        void invalidate();
        onDone();
      },
    }),
  );
  const error = review.error ?? discard.error;
  return (
    <Dialog open={!!skill} onOpenChange={onOpenChange}>
      <DialogContent size="lg" aria-describedby={`${id}-desc`} data-testid="review-skill-dialog">
        <DialogHeader>
          <DialogTitle>Review the tests for “{skill?.name}”</DialogTitle>
          <DialogDescription id={`${id}-desc`}>Keep the tests that measure the skill well. {skill?.heldOut ?? 0} more are held out: never shown, so training scores the skill blind. They count with the ones you keep.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          {(skill?.drafts ?? []).map((d) => {
            const cid = `${id}-${d.id}`;
            return (
              <div key={d.id} className="edge flex items-start gap-3 rounded-md bg-surface-2 p-3" data-test-id={d.id}>
                <Checkbox id={cid} checked={keep.includes(d.id)} onCheckedChange={(v) => setKeep((k) => (v === true ? [...new Set([...k, d.id])] : k.filter((x) => x !== d.id)))} aria-label={`Keep “${d.title}”`} />
                <label htmlFor={cid} className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-body-strong text-primary">{d.title}</span>
                  <span className="line-clamp-3 text-small text-secondary">{d.prompt}</span>
                  {d.rubric.length ? (
                    <ul className="list-disc pl-4 text-small text-tertiary">
                      {d.rubric.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : null}
                </label>
              </div>
            );
          })}
          {error ? (
            <p role="alert" className="text-small text-status-bad">
              {errorMessage(error)}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="danger" icon={Trash2} loading={discard.isPending} onClick={() => skill && discard.mutate({ businessId, agentId, definitionId: skill.definitionId })} className="mr-auto" data-testid="discard-custom-skill">
            Discard skill
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Later
          </Button>
          <Button variant="primary" icon={ClipboardCheck} disabled={keep.length === 0} loading={review.isPending} onClick={() => skill && review.mutate({ businessId, agentId, definitionId: skill.definitionId, keepTestIds: keep })} data-testid="approve-custom-skill">
            {`Approve ${keep.length} ${keep.length === 1 ? "test" : "tests"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
