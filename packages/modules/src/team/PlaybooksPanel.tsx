"use client";
/**
 * Team › Responsibilities › Playbooks (BUILD §11.13, AC-11.13.4): standing rules written in plain words. The founder writes
 * the rule, reads it back as a flow (when, then, you approve, stops), edits it, saves it off and turns it on. A playbook
 * acts only when an enabled rule's event arrives; every step still goes through the same policy, approvals and hard
 * gates as a decision. Compiling and saving go through `team.playbooks.*`.
 */
import { useId, useState } from "react";
import { ListChecks, Power, PowerOff, Trash2, X } from "lucide-react";
import { Button, Chip, Field, IconButton, Input, Panel, SimpleSelect, Textarea, formatRelative } from "@foundmill/dugout";
import { describePlaybook, type FlowLike } from "@foundmill/shared/playbook-words";
import { useWidgetQuery } from "@foundmill/widgets/data";
import { InlineError, useAction } from "./shared";

type Scope = "first_run" | "every_run";

/** The flow as the api stores it (`CompiledPlaybook` in packages/shared), loosely typed: the screen edits it and sends it back. */
interface Flow extends FlowLike {
  trigger: FlowLike["trigger"];
  steps: { action: { type: string; params?: Record<string, unknown>; agent_id?: string | null }; label?: string }[];
  approvals: { step: number; scope: Scope; note?: string }[];
  stop: NonNullable<FlowLike["stop"]>;
}

interface PlaybookRow {
  id: string;
  name: string;
  sourceText: string;
  enabled: boolean;
  lastRunAt: string | Date | null;
  compiled: Flow | null;
  preview: ReturnType<typeof describePlaybook> | null;
}

interface CompileResult {
  ok: boolean;
  question?: string;
  playbook?: { source_text: string; name?: string } & Flow;
}

/** What the founder is editing: a fresh compile, or a saved playbook. */
interface Draft {
  id: string | null;
  name: string;
  sourceText: string;
  flow: Flow;
}

const APPROVAL_OPTIONS = [
  { value: "none", label: "No approval" },
  { value: "first_run", label: "You approve the first run" },
  { value: "every_run", label: "You approve every run" },
];

export const PLAYBOOK_EXAMPLE = "When a lead replies positively, draft a reply and book a call; I approve the first message.";

function FlowEditor({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const id = useId();
  const preview = describePlaybook(draft.flow);
  const setApproval = (step: number, value: string) => {
    const rest = draft.flow.approvals.filter((a) => a.step !== step);
    onChange({ ...draft, flow: { ...draft.flow, approvals: value === "none" ? rest : [...rest, { step, scope: value as Scope }] } });
  };
  const removeStep = (index: number) =>
    onChange({
      ...draft,
      flow: {
        ...draft.flow,
        steps: draft.flow.steps.filter((_, i) => i !== index),
        // Approvals follow their steps: the removed step's goes, later ones move up.
        approvals: draft.flow.approvals.filter((a) => a.step !== index).map((a) => (a.step > index ? { ...a, step: a.step - 1 } : a)),
      },
    });
  return (
    <div className="flex flex-col gap-3" data-testid="playbook-flow">
      <Field htmlFor={`${id}-name`} label="Name">
        <Input id={`${id}-name`} value={draft.name} maxLength={120} onChange={(e) => onChange({ ...draft, name: e.target.value })} aria-label="Playbook name" />
      </Field>
      <p className="text-body-strong" data-testid="playbook-when">
        {preview.when}
      </p>
      <ol className="flex flex-col gap-2" aria-label="Steps">
        {draft.flow.steps.map((step, i) => (
          <li key={`${i}-${step.action.type}`} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2" data-testid="playbook-step">
            <span className="text-secondary tabular-nums">{i + 1}.</span>
            <span className="min-w-0 flex-1 truncate text-body">{preview.steps[i]?.text}</span>
            <SimpleSelect aria-label={`Approval for step ${i + 1}`} options={APPROVAL_OPTIONS} value={draft.flow.approvals.find((a) => a.step === i)?.scope ?? "none"} onValueChange={(v) => setApproval(i, v)} />
            <IconButton icon={X} label={`Remove step ${i + 1}`} disabled={draft.flow.steps.length <= 1} onClick={() => removeStep(i)} />
          </li>
        ))}
      </ol>
      {preview.stop ? <p className="text-small text-secondary">{preview.stop}.</p> : null}
    </div>
  );
}

export function PlaybooksPanel() {
  const list = useWidgetQuery<{ playbooks: PlaybookRow[] }>("team.playbooks.list", undefined);
  const action = useAction();
  const id = useId();
  const [text, setText] = useState("");
  const [question, setQuestion] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const rows = list.data?.playbooks ?? [];

  const compile = async () => {
    setQuestion(null);
    const res = await action.run<CompileResult>("team.playbooks.compile", { text }, { key: "compile" });
    if (!res) return;
    if (!res.ok || !res.playbook) {
      setDraft(null);
      setQuestion(res.question ?? "I could not turn that into a rule. Say when it should happen and what the team should do.");
      return;
    }
    const { source_text, name, ...flow } = res.playbook;
    setDraft({ id: null, name: name ?? "", sourceText: source_text, flow: { trigger: flow.trigger, steps: flow.steps, approvals: flow.approvals ?? [], stop: flow.stop ?? {} } });
  };

  const save = async () => {
    if (!draft) return;
    const flow = { trigger: draft.flow.trigger, steps: draft.flow.steps, approvals: draft.flow.approvals, stop: draft.flow.stop };
    const done = await (draft.id
      ? action.run("team.playbooks.update", { id: draft.id, name: draft.name || undefined, flow }, { key: "save" })
      : action.run("team.playbooks.create", { name: draft.name || undefined, sourceText: draft.sourceText, flow }, { key: "save" }));
    if (done === undefined) return;
    setDraft(null);
    setText("");
    list.refetch();
  };

  return (
    <Panel
      span={12}
      title="Playbooks"
      loading={list.isLoading && !list.data}
      error={list.error ? list.error.message : undefined}
      onRetry={list.refetch}
      meta={<span data-testid="playbooks-summary">{rows.length === 0 ? "None yet" : `${rows.length} · ${rows.filter((r) => r.enabled).length} on`}</span>}
      footer={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>A playbook is off until you turn it on. Its steps follow the same approvals and hard gates as any decision; signing, money movement and filings always stay with you.</span>
          <InlineError error={action.error} />
        </span>
      }
    >
      <div className="flex flex-col gap-4 p-panel-pad">
        <Field htmlFor={`${id}-rule`} label="New playbook" hint="Say when it should happen and what the team should do.">
          <Textarea id={`${id}-rule`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder={PLAYBOOK_EXAMPLE} aria-label="Playbook in your own words" data-testid="playbook-text" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={ListChecks} disabled={text.trim().length < 3} loading={action.pending === "compile"} onClick={() => void compile()} data-testid="playbook-preview">
            Show the flow
          </Button>
          {question ? (
            <p role="status" className="text-small text-secondary" data-testid="playbook-question">
              {question}
            </p>
          ) : null}
        </div>

        {draft ? (
          <div className="flex flex-col gap-3 rounded-lg border border-line p-3" data-testid="playbook-draft">
            <FlowEditor draft={draft} onChange={setDraft} />
            <div className="flex items-center gap-2">
              <Button variant="primary" loading={action.pending === "save"} disabled={draft.flow.steps.length === 0} onClick={() => void save()} data-testid="playbook-save">
                {draft.id ? "Save changes" : "Save (off)"}
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Discard
              </Button>
            </div>
          </div>
        ) : null}

        {rows.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Playbooks" data-testid="playbook-list">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start gap-3 rounded-md border border-line-faint px-3 py-2" data-testid="playbook-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-strong">{row.name || row.sourceText.slice(0, 60)}</span>
                    <Chip tone={row.enabled ? "good" : "neutral"}>{row.enabled ? "On" : "Off"}</Chip>
                  </div>
                  {row.preview ? (
                    <p className="text-small text-secondary">
                      {row.preview.when}, then {row.preview.steps.map((s) => s.text.toLowerCase()).join(", then ")}
                      {row.preview.steps.some((s) => s.approval) ? ` (${row.preview.steps.find((s) => s.approval)?.approval?.toLowerCase()})` : ""}
                      {row.preview.stop ? `. ${row.preview.stop}` : ""}.
                    </p>
                  ) : (
                    <p className="text-small text-secondary">{row.sourceText} (written in an older format; write it again to turn it on)</p>
                  )}
                  <p className="text-small text-secondary">{row.lastRunAt ? `Last ran ${formatRelative(new Date(row.lastRunAt))}` : "Has not run yet"}</p>
                </div>
                <div className="flex items-center gap-1">
                  {row.compiled ? (
                    <Button size="sm" variant="ghost" onClick={() => setDraft({ id: row.id, name: row.name, sourceText: row.sourceText, flow: { trigger: row.compiled!.trigger, steps: row.compiled!.steps, approvals: row.compiled!.approvals ?? [], stop: row.compiled!.stop ?? {} } })}>
                      Edit
                    </Button>
                  ) : null}
                  <Button size="sm" icon={row.enabled ? PowerOff : Power} disabled={!row.compiled} loading={action.pending === `toggle:${row.id}`} onClick={() => void action.run("team.playbooks.setEnabled", { id: row.id, enabled: !row.enabled }, { key: `toggle:${row.id}`, then: () => list.refetch() })}>
                    {row.enabled ? "Turn off" : "Turn on"}
                  </Button>
                  <IconButton icon={Trash2} label={`Remove ${row.name || "playbook"}`} onClick={() => void action.run("team.playbooks.archive", { id: row.id }, { key: `archive:${row.id}`, then: () => list.refetch() })} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Panel>
  );
}
