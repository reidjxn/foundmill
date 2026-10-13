"use client";
/**
 * An agent's request to make one gated call (audit FR-01): who asks, for which task, the call, what it would send and
 * the amount, and where it stands. Approve and Reject are the note's DecisionBar; the optional reason here goes with
 * the answer (a rejection quotes it to the agent and in the Chief of Staff's note). The agent links to its profile;
 * the task, which is not a CRM record, links to the Plan with the same entity-link style Team › Agents uses for it.
 */
import { useRouter } from "next/navigation";
import { EntityLink, Field, KeyValueList, Panel, StatusPill, Textarea, fieldDescribedBy, formatMoney, type KeyValueItem } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import type { RouterOutputs } from "@/lib/trpc";
import { approvalLockedReason, approvalStatus, taskHref, type DepartmentForLinks } from "./logic";

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
    { label: "Wants to run", value: <span data-testid="approval-action">{approval.action}</span> },
    {
      label: "What it sends",
      value: approval.argsHidden ? HIDDEN : approval.args ? <span className="break-words font-mono text-mono" data-testid="approval-args">{approval.args}</span> : <span className="text-secondary">No arguments</span>,
    },
    ...(approval.amount || approval.amountHidden ? [{ label: "Amount", value: approval.amount ? <span data-testid="approval-amount">{formatMoney(approval.amount)}</span> : HIDDEN, numeric: true }] : []),
    ...(approval.reasons.length ? [{ label: "Why it asks", value: approval.reasons.join("; ") }] : []),
  ];
  return (
    <Panel title="Agent request" span={12} actions={<StatusPill tone={status.tone}>{status.word}</StatusPill>} footer={<span data-testid="approval-status-detail">{status.detail}</span>} data-testid="approval-panel">
      <div className="flex flex-col gap-3">
        <KeyValueList items={items} />
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
