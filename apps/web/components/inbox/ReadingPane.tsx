"use client";
/**
 * The reading pane (BUILD §11.3 "Anatomy", DESIGN §9 Inbox): 64 px header (persona EntityLink, date, department chip,
 * related entities), the note in reading style (Markdown with entity markup → EntityLinks), a status strip of up to
 * four live metrics with provenance, the exhibit, and the DecisionBar (1–4 hotkeys through the shell's keyboard map,
 * free text → `inbox.decide`). When policy says "ask", "Here is what will happen" lists every action with its cost
 * before `plan.confirm`. Answered items show what was chosen, the plan's progress and follow-up links. Won customers
 * open their Customer Update (the replay).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, Check, ExternalLink, Play, ShieldAlert, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Button,
  Chip,
  DecisionBar,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EntityLink,
  KeyValueList,
  Markdown,
  Panel,
  StatusPill,
  StatusStrip,
  formatDateTime,
  formatMoney,
  formatRelative,
  useToast,
  type DecisionAnswer,
  type DecisionOption,
} from "@foundmill/dugout";
import type { DeptColourToken, EntityKind } from "@foundmill/shared";
import { routes } from "@foundmill/widgets/shared/routes";
import { usePageShortcuts } from "@/lib/keys";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { Exhibit } from "./Exhibit";
import {
  TYPE_META,
  agentIndex,
  answeredFrom,
  confirmationLines,
  decisionExpired,
  followUpLinks,
  freeTextAllowed,
  headerDates,
  journeyForItem,
  planStatusLine,
  statusStripTiles,
  stripSources,
  toDecisionOptions,
  totalCost,
  type ConfirmationLine,
} from "./logic";

type InboxGet = RouterOutputs["inbox"]["get"];
type DecideResult = RouterOutputs["inbox"]["decide"];

const DAY_MS = 86_400_000;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export interface ReadingPaneProps {
  itemId: string;
  onArchived?: () => void;
}

export function ReadingPane({ itemId, onArchived }: ReadingPaneProps) {
  const { businessId, data: biz, departments } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const currency = biz.business.glossary?.currency ?? "EUR";
  const getQ = useQuery(trpc.inbox.get.queryOptions({ businessId, itemId }, { staleTime: 10_000 }));
  const invalidate = useCallback((routers: readonly string[]) => Promise.all(routers.map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))), [queryClient]);

  // Mark read once per item (the list and the sidebar badges follow through invalidation).
  const markRead = useMutation(trpc.inbox.markRead.mutationOptions({ onSuccess: () => void invalidate(["inbox"]) }));
  const unread = getQ.data?.item.state === "unread";
  useEffect(() => {
    if (unread && !markRead.isPending && !markRead.isSuccess) markRead.mutate({ businessId, itemId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when the item turns out to be unread
  }, [unread, businessId, itemId]);

  if (getQ.error) return <ErrorPanel title="Note" message={errorMessage(getQ.error)} onRetry={() => void getQ.refetch()} />;
  if (!getQ.data) return <ScreenSkeleton rows={4} />;
  return <ReadingPaneBody data={getQ.data} currency={currency} departments={departments} onArchived={onArchived} />;
}

/* ---------- body ---------- */

interface BodyProps {
  data: InboxGet;
  currency: string;
  departments: ReturnType<typeof useBusiness>["departments"];
  onArchived?: () => void;
}

function ReadingPaneBody({ data, currency, departments, onArchived }: BodyProps) {
  const { item, decisions, plan: storedPlan, fromAgent, entities } = data;
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const invalidate = useCallback((routers: readonly string[]) => Promise.all(routers.map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))), [queryClient]);

  const agents = useMemo(() => agentIndex(departments), [departments]);
  const persona = fromAgent ? agents.get(fromAgent.id) : undefined;
  const department = persona ? departments.find((d) => d.id === persona.departmentId) : undefined;
  const meta = TYPE_META[item.type];
  const dates = headerDates(item, decisions[0]?.decidedAt ?? null);

  // --- status strip sources (only what the note needs) ---------------------------------------------------------------
  const needs = useMemo(() => stripSources(item.statusStrip), [item.statusStrip]);
  const today = dayKey(new Date());
  const from30 = dayKey(new Date(Date.now() - 30 * DAY_MS));
  const financeQ = useQuery(trpc.finance.overview.queryOptions({ businessId }, { enabled: needs.has("finance"), staleTime: 60_000, retry: false }));
  const ribbonQ = useQuery(trpc.journey.ribbon.queryOptions({ businessId, from: from30, to: today }, { enabled: needs.has("conversions"), staleTime: 60_000, retry: false }));
  const tasksQ = useQuery(trpc.dev.tasks.list.queryOptions({ businessId, limit: 500 }, { enabled: needs.has("tasks"), staleTime: 30_000, retry: false }));
  const channelsQ = useQuery(trpc.distribution.channels.list.queryOptions({ businessId }, { enabled: needs.has("channels"), staleTime: 60_000, retry: false }));
  const tiles = useMemo(
    () =>
      statusStripTiles(item.statusStrip, {
        finance: financeQ.data ?? null,
        conversions: ribbonQ.data?.conversions ?? null,
        tasks: tasksQ.data?.items ?? null,
        channelsEnabled: channelsQ.data ? channelsQ.data.channels.filter((c) => c.enabled).length : null,
      }).map((t) => ({ ...t, loading: (needs.has("finance") && financeQ.isLoading) || (needs.has("conversions") && ribbonQ.isLoading) || (needs.has("tasks") && tasksQ.isLoading) || (needs.has("channels") && channelsQ.isLoading) })),
    [item.statusStrip, financeQ.data, financeQ.isLoading, ribbonQ.data, ribbonQ.isLoading, tasksQ.data, tasksQ.isLoading, channelsQ.data, channelsQ.isLoading, needs],
  );

  // --- won customer → replay ----------------------------------------------------------------------------------------
  const won = item.type === "customer_won";
  const journeysQ = useQuery(trpc.journey.list.queryOptions({ businessId, kind: "payment", limit: 50 }, { enabled: won, staleTime: 30_000, retry: false }));
  const journeyId = useMemo(() => journeyForItem({ type: item.type, entityIds: item.entityIds, createdAt: item.createdAt }, journeysQ.data?.items), [item.type, item.entityIds, item.createdAt, journeysQ.data?.items]);
  const openReplay = useCallback(() => {
    if (journeyId) router.push(routes.journey(businessId, journeyId));
  }, [journeyId, router, businessId]);

  // --- decision ------------------------------------------------------------------------------------------------------
  const options = useMemo(() => toDecisionOptions(item.decision, currency), [item.decision, currency]);
  const expired = decisionExpired(item.decision);
  const [result, setResult] = useState<DecideResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const plan = result?.plan ?? storedPlan;
  const answered: DecisionAnswer | undefined = useMemo(() => {
    if (result) return result.decision.chosenOption ? { optionId: result.decision.chosenOption } : result.decision.freeText ? { text: result.decision.freeText } : undefined;
    return answeredFrom(decisions);
  }, [result, decisions]);
  const isAnswered = !!answered || item.state === "answered" || item.state === "archived";

  const decide = useMutation(
    trpc.inbox.decide.mutationOptions({
      onSuccess: (res) => {
        setResult(res);
        // Continue follows inbox.list (AC-11.3.3); plan/dev/distribution screens follow the executed actions.
        void invalidate(["inbox", "plan", "dev", "distribution", "team", "business"]);
        if (res.requiresConfirmation) setConfirmOpen(true);
        else {
          toast({ title: "Decided", description: res.executed.length ? `${res.executed.length} action${res.executed.length === 1 ? "" : "s"} done, ${res.deferred.length} handed to the team.` : res.plan.summaryMd.slice(0, 140), tone: "good", action: res.followUp ? { label: "Open the update", onClick: () => router.push(routes.inbox(businessId, res.followUp!.id)) } : undefined });
          if (won && journeyId) router.push(routes.journey(businessId, journeyId));
        }
      },
      onError: (err) => toast({ title: "Could not record the decision", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const confirm = useMutation(
    trpc.plan.confirm.mutationOptions({
      onSuccess: (res) => {
        setConfirmOpen(false);
        setResult((prev) => (prev ? { ...prev, plan: res.plan, requiresConfirmation: false, executed: res.exec.executed, deferred: res.exec.deferred, denied: res.exec.denied, followUp: res.followUp ?? prev.followUp } : prev));
        void invalidate(["inbox", "plan", "dev", "distribution", "team", "business"]);
        toast({ title: "Confirmed", description: `${res.exec.executed.length} action${res.exec.executed.length === 1 ? "" : "s"} started${res.dispatch && !res.dispatch.queued ? "; the orchestrator is offline, the rest run when it returns" : ""}.`, tone: "good", action: res.followUp ? { label: "Open the update", onClick: () => router.push(routes.inbox(businessId, res.followUp!.id)) } : undefined });
        if (won && journeyId) router.push(routes.journey(businessId, journeyId));
      },
      onError: (err) => toast({ title: "Could not confirm the plan", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const archive = useMutation(
    trpc.inbox.archive.mutationOptions({
      onSuccess: () => {
        void invalidate(["inbox"]);
        toast({ title: "Archived", tone: "info" });
        onArchived?.();
      },
      onError: (err) => toast({ title: "Could not archive", description: errorMessage(err), tone: "bad" }),
    }),
  );

  const locked = isAnswered || expired || decide.isPending || confirm.isPending;
  const onChoose = useCallback((o: DecisionOption) => decide.mutate({ businessId, itemId: item.id, chosenOption: o.id }), [decide, businessId, item.id]);
  const onExecute = useCallback((text: string) => decide.mutate({ businessId, itemId: item.id, freeText: text }), [decide, businessId, item.id]);
  usePageShortcuts({
    onChooseOption: options.length && !locked ? (n) => {
      const o = options[n - 1];
      if (o && !o.disabled) onChoose(o);
    } : undefined,
  });

  const lines: ConfirmationLine[] = useMemo(() => (result ? confirmationLines(result.evaluations, currency) : []), [result, currency]);
  const links = useMemo(() => (plan ? followUpLinks(plan.actions, businessId, departments) : []), [plan, businessId, departments]);
  const planLine = planStatusLine(plan);
  const pendingConfirmation = plan?.status === "pending_confirmation";
  const relatedEntities = entities.map((e) => ({ id: e.id, kind: e.kind as EntityKind, name: e.displayName, href: routes.crm(businessId, e.id) }));

  return (
    <article className="flex min-h-0 flex-1 flex-col" data-testid="inbox-item" data-item-id={item.id} data-type={item.type} data-state={isAnswered ? "answered" : item.state}>
      {/* header */}
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-subtle bg-panel px-gutter py-2" data-testid="inbox-item-header">
        {persona ? <Avatar size={32} name={persona.name} agent={{ seed: persona.seed, dept: persona.dept as DeptColourToken }} /> : <Avatar size={32} name={item.fromUserId ? "You" : "Team"} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="t-display-sm truncate text-primary">{item.subject}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-secondary">
            {fromAgent ? (
              <EntityLink entity={{ id: fromAgent.id, kind: "agent", name: fromAgent.name, href: routes.agent(businessId, fromAgent.id) }} onOpen={() => router.push(routes.agent(businessId, fromAgent.id))} hoverCard={false} contextMenu={false} data-testid="persona-link" />
            ) : (
              <span>{item.fromUserId ? "You" : "Team"}</span>
            )}
            {persona?.role ? <span>{persona.role}</span> : null}
            <span aria-hidden>·</span>
            <time dateTime={dates.created.toISOString()} title={formatDateTime(dates.created)}>
              {formatRelative(dates.created)}
            </time>
            {dates.decided ? <span>· decided {formatRelative(dates.decided)}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill tone={meta.tone === "neutral" ? "info" : meta.tone} data-testid="type-pill">
            {meta.word}
          </StatusPill>
          {department ? (
            <Chip tone={department.colourToken as DeptColourToken} data-testid="department-chip">
              {department.name}
            </Chip>
          ) : null}
          {item.blocksContinue && !isAnswered ? <Chip tone="bad">Blocks Continue</Chip> : null}
          {relatedEntities.slice(0, 3).map((e) => (
            <EntityLink key={e.id} entity={e} className="text-small" />
          ))}
          {relatedEntities.length > 3 ? <span className="text-small text-secondary">+{relatedEntities.length - 3}</span> : null}
          {item.state !== "archived" && (isAnswered || !options.length) ? <Button size="sm" variant="ghost" icon={Archive} onClick={() => archive.mutate({ businessId, itemId: item.id })} loading={archive.isPending} data-testid="archive-item">Archive</Button> : null}
        </div>
      </header>

      {/* scrolling body */}
      <div className="flex min-h-0 flex-1 flex-col gap-gutter overflow-y-auto p-gutter">
        {won ? (
          <Panel title="Customer Update" span={12} actions={<Chip tone="gold">Win</Chip>} data-testid="customer-update">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-body text-secondary">The replay shows the first touch, who was involved, the win moment and the debrief.</p>
              <Button variant="primary" icon={Play} onClick={openReplay} disabled={!journeyId} loading={journeysQ.isLoading} data-testid="open-replay">
                Open the Customer Update
              </Button>
            </div>
            {!journeysQ.isLoading && !journeyId ? <p className="mt-2 text-small text-secondary">The replay is still being built; it appears here once the journey is recorded.</p> : null}
          </Panel>
        ) : null}

        <InboxNote bodyMd={item.bodyMd} />

        {tiles.length ? <StatusStrip tiles={tiles} data-testid="status-strip" /> : null}

        <Exhibit exhibit={item.exhibit} entityIds={item.entityIds} fromAgentId={item.fromAgentId} currency={currency} />

        {isAnswered || plan ? (
          <Panel title="Decided" span={12} actions={planLine ? <StatusPill tone={planLine.tone}>{planLine.word}</StatusPill> : undefined} footer={planLine ? <span>{planLine.detail}</span> : undefined} data-testid="answered-panel">
            <div className="flex flex-col gap-3">
              <KeyValueList
                items={[
                  { label: "Your answer", value: answered?.optionId ? options.find((o) => o.id === answered.optionId)?.label ?? answered.optionId : answered?.text ? <q>{answered.text}</q> : "Recorded" },
                  ...(plan ? [{ label: "Plan", value: <Markdown variant="body">{plan.summaryMd || "No actions"}</Markdown> }] : []),
                ]}
              />
              {plan?.actions.length ? (
                <ul className="flex flex-col gap-1 text-small" data-testid="plan-actions">
                  {plan.actions.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <StatusPill tone={a.status === "done" ? "good" : a.status === "failed" || a.status === "denied" ? "bad" : a.status === "awaiting_approval" || a.status === "pending" ? "warn" : "info"}>{a.status.replace(/_/g, " ")}</StatusPill>
                      <span className="truncate">{confirmationLines([{ action: { type: a.type, params: a.params as Record<string, unknown> | null }, outcome: a.policyOutcome ?? "allow" }], currency)[0]?.label}</span>
                      {a.policyOutcome === "ask" ? <Chip tone="warn">Confirmed by you</Chip> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {pendingConfirmation && result ? (
                  <Button size="sm" variant="primary" icon={ShieldAlert} onClick={() => setConfirmOpen(true)} data-testid="reopen-confirmation">
                    Review what will happen
                  </Button>
                ) : null}
                {result?.followUp ? (
                  <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => router.push(routes.inbox(businessId, result.followUp!.id))} data-testid="open-follow-up">
                    Open the follow-up update
                  </Button>
                ) : null}
                {links.map((l) => (
                  <Button key={l.id} size="sm" variant="ghost" icon={ExternalLink} onClick={() => router.push(l.href)} data-follow-up-link={l.href}>
                    {l.label}
                  </Button>
                ))}
                {won && journeyId ? (
                  <Button size="sm" variant="ghost" icon={Trophy} onClick={openReplay}>
                    Watch the replay again
                  </Button>
                ) : null}
              </div>
            </div>
          </Panel>
        ) : null}
      </div>

      {/* decision bar */}
      {options.length >= 2 ? (
        <DecisionBar
          options={options}
          onChoose={onChoose}
          onExecute={freeTextAllowed(item.decision) ? onExecute : undefined}
          disabled={expired || item.state === "archived"}
          executing={decide.isPending || confirm.isPending}
          answered={answered}
          hotkeys={false}
          note={expired && !isAnswered ? <span className="inline-flex items-center gap-1 text-small text-status-warn">This decision expired; the team moved on with the recommended option.</span> : undefined}
          data-testid="decision-bar"
        />
      ) : null}

      <ConfirmPlanDialog open={confirmOpen} onOpenChange={setConfirmOpen} lines={lines} summary={result?.plan.summaryMd ?? ""} currency={currency} loading={confirm.isPending} onConfirm={() => result && confirm.mutate({ businessId, planId: result.plan.id })} />
      {decide.isError || confirm.isError ? (
        <p className="sr-only" role="alert">
          {errorMessage(decide.error ?? confirm.error)}
        </p>
      ) : null}
    </article>
  );
}

/* ---------- "Here is what will happen" ---------- */

export interface ConfirmPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lines: readonly ConfirmationLine[];
  summary: string;
  currency: string;
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmPlanDialog({ open, onOpenChange, lines, summary, currency, loading, onConfirm }: ConfirmPlanDialogProps) {
  const total = totalCost(lines, currency);
  const asks = lines.filter((l) => l.outcome === "ask").length;
  const denied = lines.filter((l) => l.outcome === "deny").length;
  const gates = lines.filter((l) => l.hardGate).length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="confirm-plan">
        <DialogHeader>
          <DialogTitle>Here is what will happen</DialogTitle>
          <DialogDescription>
            {asks} action{asks === 1 ? " sits" : "s sit"} outside the current policy and need{asks === 1 ? "s" : ""} your go-ahead.{denied ? ` ${denied} ${denied === 1 ? "is" : "are"} denied and will be skipped.` : ""}
            {gates ? ` ${gates} ${gates === 1 ? "is" : "are"} hard-gated: the team prepares everything and you act.` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            {summary ? <Markdown variant="body">{summary}</Markdown> : null}
            <ol className="flex flex-col divide-y divide-subtle rounded-panel border border-subtle" data-testid="confirm-plan-lines">
              {lines.map((l, i) => (
                <li key={i} className="flex items-center gap-3 px-panel-pad py-2" data-outcome={l.outcome}>
                  <StatusPill tone={l.outcome === "allow" ? "good" : l.outcome === "ask" ? "warn" : l.outcome === "deny" ? "bad" : "neutral"}>{l.outcome === "allow" ? "Within policy" : l.outcome === "ask" ? "Needs your go-ahead" : l.outcome === "deny" ? "Denied" : l.outcome}</StatusPill>
                  <span className="min-w-0 flex-1 truncate text-body">{l.label}</span>
                  {l.hardGate ? <Chip tone="ink">You act</Chip> : null}
                  <span className="shrink-0 text-small text-secondary tabular-nums">{l.cost ? formatMoney(l.cost) : "No cost"}</span>
                </li>
              ))}
            </ol>
            <KeyValueList items={[{ label: "Total cost", value: total ? formatMoney(total) : "No cost", numeric: true, hint: total ? "Estimate: budgets and caps as planned, not spend to date." : undefined }]} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Not now
          </Button>
          <Button variant="primary" icon={Check} loading={loading} onClick={onConfirm} data-testid="confirm-plan-go">
            Go ahead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The note body in the reading style. Dugout's Markdown keeps its own props, so the test id lives on this wrapper. */
export function InboxNote({ bodyMd }: { bodyMd: string }) {
  return (
    <div data-testid="inbox-note">
      <Markdown variant="reading" className="t-reading">
        {bodyMd}
      </Markdown>
    </div>
  );
}
