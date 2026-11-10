"use client";
/**
 * An agent's request to make one gated call (audit FR-01; UX plan B5): one plain sentence first ("Priya wants to set
 * the LinkedIn Ads budget to £600 a week"), then **what exactly would run** (first-time founder report, Nov 8, 2026: the
 * files of a code change, the copy and budget of a campaign, the recipient and message of outreach, the amount of a
 * spend), always shown, whatever Builder view says; then who asks, for which task, the amount and why it asks. The
 * call's name, the rule and the raw arguments wait behind "Details" on ink, Builder view only. A request that said
 * nothing about what it would run, or a GitHub call with no repository connected, says so where the founder decides.
 * Approve and Reject are the note's DecisionBar; the optional reason here goes with the answer (a rejection quotes it to
 * the agent and in the Chief of Staff's note). The agent links to its profile; the task, which is not a CRM record,
 * links to the Plan with the same entity-link style Team › Agents uses for it. A batched note (several campaign
 * launches, one decision) lists each request with its own "what exactly" behind an expander.
 */
import { ChevronRight, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { BuilderOnly, EntityLink, Field, Icon, KeyValueList, Panel, StatusPill, Textarea, fieldDescribedBy, formatMoney, useAgentPersona, type KeyValueItem } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import type { RouterOutputs } from "@/lib/trpc";
import { approvalLockedReason, approvalStatus, taskHref, type DepartmentForLinks } from "./logic";
import { describeRequest, toolKeyOf } from "./request";

type ApprovalView = NonNullable<RouterOutputs["inbox"]["get"]["approval"]>;
type ApprovalWhat = NonNullable<ApprovalView["what"]>;

/** What the founder reads when the agent gave nothing that says what would run. */
export const NO_CONTENT_NOTICE = "The agent did not say exactly what it would run, so there is nothing here to approve. Ask for the details: it is told to describe the files, the recipients, the copy or the amounts and ask again.";
/** What the founder reads when a GitHub call has no repository to run on. */
export const NO_GITHUB_NOTICE = "No GitHub repository is connected to this business, so this has nowhere to run.";

/** The "What exactly" rows as a key/value list; the headline first when there is one. */
function WhatRows({ what, dense }: { what: ApprovalWhat; dense?: boolean }) {
  const items: KeyValueItem[] = what.rows.map((r) => ({ label: r.label, value: r.mono ? <span className="break-words font-mono text-mono text-primary">{r.value}</span> : r.value, mono: r.mono }));
  return (
    <div className="flex flex-col gap-2">
      {what.headline ? (
        <p className="text-body text-pretty text-primary" data-testid="approval-what-headline">
          {what.headline}
        </p>
      ) : null}
      {items.length ? <KeyValueList items={items} dense={dense} labelClassName="w-28" /> : null}
    </div>
  );
}

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
  const what = approval.what ?? null;
  const batch = approval.batch ?? [];
  const noContent = approval.outcome === null && what !== null && what.empty && batch.length === 0;
  const noGithub = approval.githubConnected === false;
  const integrationsHref = routes.settings(businessId, "integrations");
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
        {/* What exactly would run: the founder's own view of the call, before anything about who asked or why. */}
        {noGithub ? (
          <p className="flex items-start gap-2 rounded-sm border border-status-warn/40 bg-status-warn/8 px-3 py-2 text-small text-primary" role="status" data-testid="approval-no-github">
            <Icon icon={TriangleAlert} size="inline" className="mt-0.5 shrink-0 text-status-warn" />
            <span>
              {NO_GITHUB_NOTICE}{" "}
              <a
                href={integrationsHref}
                className="text-link hover:underline"
                data-testid="approval-connect-github"
                onClick={(e) => {
                  e.preventDefault();
                  router.push(integrationsHref);
                }}
              >
                Connect GitHub in Settings › Integrations
              </a>
              , then the agent asks again when it next works on the task.
            </span>
          </p>
        ) : null}
        <section className="flex flex-col gap-2 rounded-sm border border-line-faint px-3 py-2" aria-labelledby="approval-what-title" data-testid="approval-what" data-what-kind={batch.length > 1 ? "batch" : approval.argsHidden || what === null ? "hidden" : what.kind}>
          <h4 id="approval-what-title" className="t-data">
            What exactly
          </h4>
          {batch.length > 1 ? (
            <ol className="flex flex-col gap-1.5" aria-label="Requests in this decision">
              {batch.map((b, i) => (
                <li key={b.id}>
                  <details className="group/batch" data-testid="approval-batch-row" open={i === 0}>
                    <summary className="flex cursor-pointer list-none items-center gap-1 rounded-sm text-small text-primary transition-colors duration-hover ease-out hover:text-primary [&::-webkit-details-marker]:hidden">
                      <Icon icon={ChevronRight} size="inline" className="transition-transform duration-overlay ease-out group-open/batch:rotate-90" />
                      <span className="text-body-strong">{b.what?.headline ?? b.action}</span>
                      {b.amount ? <span className="ml-auto tabular-nums text-secondary">{formatMoney(b.amount)}</span> : null}
                    </summary>
                    <div className="mt-2 pl-5">{b.what ? <WhatRows what={{ ...b.what, headline: null }} dense /> : HIDDEN}</div>
                  </details>
                </li>
              ))}
            </ol>
          ) : approval.argsHidden || what === null ? (
            HIDDEN
          ) : what.empty ? (
            <p className="flex items-start gap-2 text-small text-primary" role="status" data-testid="approval-no-content">
              <Icon icon={TriangleAlert} size="inline" className="mt-0.5 shrink-0 text-status-warn" />
              <span>{noContent ? NO_CONTENT_NOTICE : "The agent did not say exactly what it would run."}</span>
            </p>
          ) : (
            <WhatRows what={what} />
          )}
        </section>
        <KeyValueList items={items} />
        {/* The system's own words (the call, the rule, the arguments) are Builder view's. */}
        <BuilderOnly>
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
        </BuilderOnly>
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
