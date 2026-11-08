"use client";
/**
 * An agent's request to make one gated call (audit FR-01; UX plan B5): one plain sentence first ("Priya wants to set
 * the LinkedIn Ads budget to £600 a week"), then who asks, for which task, the amount and why it asks; the call's name
 * and the raw arguments wait behind "Details" on ink. Approve and Reject are the note's DecisionBar; the optional reason
 * here goes with the answer (a rejection quotes it to the agent and in the Chief of Staff's note). The agent links to
 * its profile; the task, which is not a CRM record, links to the Plan with the same entity-link style Team › Agents
 * uses for it.
 */
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { EntityLink, Field, Icon, KeyValueList, Panel, StatusPill, Textarea, fieldDescribedBy, formatMoney, useAgentPersona, type KeyValueItem } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import type { RouterOutputs } from "@/lib/trpc";
import { approvalLockedReason, approvalStatus, taskHref, type DepartmentForLinks } from "./logic";
import { describeRequest, toolKeyOf } from "./request";

type ApprovalView = NonNullable<RouterOutputs["inbox"]["get"]["approval"]>;

export interface ApprovalPanelProps {
  approval: ApprovalView;
  businessId: string;
  departments: readonly DepartmentForLinks[];
  /** The reason typed so far; sent with Approve or Reject. */
  reason: string;
  onReasonChange: (reason: string) => void;
  /** The note was answered (or is being answered): the reason can no longer change. */
  answered: boolean;
}

const REASON_ID = "approval-reason";
const HIDDEN = <span className="text-secondary">Hidden by your section permissions</span>;

export function ApprovalPanel({ approval, businessId, departments, reason, onReasonChange, answered }: ApprovalPanelProps) {
  const router = useRouter();
  // The summary names the agent as the sender line does, under the reader's preference.
  const persona = useAgentPersona();
  const status = approvalStatus(approval);
  const locked = approvalLockedReason(approval);
  const open = approval.outcome === null && !answered;
  const href = approval.task ? taskHref(businessId, departments, approval.task.id) : null;
  const items: KeyValueItem[] = [
    {
      label: "Agent",
      value: approval.agent ? (
        <EntityLink entity={{ id: approval.agent.id, kind: "agent", name: approval.agent.name, href: routes.agent(businessId, approval.agent.id) }} onOpen={() => router.push(routes.agent(businessId, approval.agent!.id))} hoverCard={false} contextMenu={false} data-testid="approval-agent" />
      ) : (
        "The team"
      ),
    },
    ...(approval.task
      ? [
          {
            label: "Task",
            value: href ? (
              <a
                href={href}
                className="entity-link"
                data-testid="approval-task"
                onClick={(e) => {
                  e.preventDefault();
                  router.push(href);
                }}
              >
                {approval.task.title}
              </a>
            ) : (
              <span data-testid="approval-task">{approval.task.title}</span>
            ),
          },
        ]
      : []),
    ...(approval.amount || approval.amountHidden ? [{ label: "Amount", value: approval.amount ? <span data-testid="approval-amount">{formatMoney(approval.amount)}</span> : HIDDEN, numeric: true }] : []),
    ...(approval.why?.length ? [{ label: "Why you are asked", value: approval.why.join(" ") }] : []),
  ];
  return (
    <Panel title="Agent request" span={12} help={toolKeyOf(approval) === "merge_pr" || toolKeyOf(approval) === "merge_pull_request" ? "A finished change is code an agent wrote and tested on its own working copy. Putting it live adds it to the product everyone uses." : undefined} actions={<StatusPill tone={status.tone}>{status.word}</StatusPill>} footer={<span data-testid="approval-status-detail">{status.detail}</span>} data-testid="approval-panel">
      <div className="flex flex-col gap-3">
        {/* The business thing first (UX plan §5.2); the system's words wait behind Details. */}
        <p className="text-body-strong text-pretty text-primary" data-testid="approval-summary">
          {describeRequest({ ...approval, agent: approval.agent ? { name: persona.labelFor(approval.agent) } : null })}.
        </p>
        <KeyValueList items={items} />
        <details className="group/detail" data-testid="approval-details">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm px-1.5 text-small text-secondary transition-colors duration-hover ease-out hover:text-primary [&::-webkit-details-marker]:hidden">
            <Icon icon={ChevronRight} size="inline" className="transition-transform duration-overlay ease-out group-open/detail:rotate-90" />
            Details
          </summary>
          <dl className="mt-2 flex flex-col gap-2 rounded-sm border border-line-faint bg-ink p-3">
            <div className="flex flex-col gap-0.5">
              <dt className="t-data">The call</dt>
              <dd className="text-body text-primary" data-testid="approval-action">
                {approval.action}
              </dd>
            </div>
            {approval.reasons.length ? (
              <div className="flex flex-col gap-0.5">
                <dt className="t-data">The rule that asked</dt>
                <dd className="text-small text-secondary" data-testid="approval-reasons">
                  {approval.reasons.join("; ")}
                </dd>
              </div>
            ) : null}
            <div className="flex flex-col gap-0.5">
              <dt className="t-data">What it sends</dt>
              <dd>{approval.argsHidden ? HIDDEN : approval.args ? <span className="break-words font-mono text-mono text-secondary" data-testid="approval-args">{approval.args}</span> : <span className="text-small text-secondary">No arguments</span>}</dd>
            </div>
          </dl>
        </details>
        {open && !locked ? (
          <Field htmlFor={REASON_ID} label="Reason (optional)" hint="Sent with your answer. If you reject, the agent is told why.">
            <Textarea id={REASON_ID} value={reason} onChange={(e) => onReasonChange(e.target.value)} maxLength={2000} rows={2} aria-describedby={fieldDescribedBy(REASON_ID, { hint: true })} data-testid="approval-reason" />
          </Field>
        ) : null}
        {open && locked ? (
          <p className="text-small text-secondary" data-testid="approval-locked">
            {locked}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
