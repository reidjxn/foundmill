"use client";
/**
 * The reading pane (BUILD §11.3 "Anatomy", DESIGN §9 Inbox): 64 px header (persona EntityLink, date in the signed-in
 * person's own format with the relative time beside it, department chip,
 * related entities), the note in reading style (Markdown with entity markup → EntityLinks), a status strip of up to
 * four live metrics with provenance, the exhibit, the conversation with the agent who wrote it (DIRECTION #6: quick
 * replies on Alt+1–4, T to talk; typed text goes through `agent.conversation.inboxReply`, so a question never uses up
 * the decision) and the DecisionBar (1–4 through the shell's keyboard map; "Ask <agent>" opens the conversation's
 * Write field instead of a free-text box). When policy says "ask", "Here is what will happen" lists every action with
 * its cost before `plan.confirm`. The plan waits in the database, so the go-ahead is offered from what inbox.get returns
 * (`confirmation`), after a reload, from another tab or device, never from what this page remembers (audit OL-01).
 * Answered items show what was chosen, the plan's progress and follow-up links. Won customers open their Customer
 * Update (the replay). An agent's request to make a gated call (audit FR-01) shows the agent, the task, the call and its
 * amount above the DecisionBar's Approve and Reject, with an optional reason. While guidance is on, the exhibit and
 * the Decided panel start folded under "Show the numbers" / "Show what happened" (UX plan B19), so the note, the
 * conversation and the decision bar read as one story; a Decided panel that still asks for the go-ahead, or one for a
 * decision just taken here, opens as it always did. The guided layer (UX plan §6.2, §7.9): the note body's defined
 * terms get their definition on hover (Markdown `terms`), the header's status word and "Your decision" carry an
 * InfoTip, the metric strip's captions and the Customer Update title are Terms, and the first decision an account
 * ever meets shows one Callout on the first option ("Each option says what it costs and whether you can undo it").
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, ChevronDown, ChevronRight, CirclePause, ExternalLink, EyeOff, Play, ShieldAlert, Trophy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Avatar,
  Button,
  Callout,
  Chip,
  DecisionBar,
  DeptChip,
  EntityLink,
  InfoTip,
  KeyValueList,
  Markdown,
  Panel,
  StatusPill,
  StatusStrip,
  Term,
  Tooltip,
  formatRelative,
  isTypingTarget,
  useFormatters,
  useGuided,
  useTerm,
  useToast,
  type DecisionAnswer,
  type DecisionOption,
  type MetricTileProps,
} from "@foundmill/dugout";
import type { DeptColourToken, EntityKind } from "@foundmill/shared";
import { humanSender, NETWORK_SENDER } from "@foundmill/widgets/shared/note-tags";
import { routes } from "@foundmill/widgets/shared/routes";
import { readOnlyReason } from "@/lib/access";
import { entityHref } from "@/lib/entity-links";
import { isGuid } from "@/lib/ids";
import { monthStart, pnlTotals } from "@foundmill/modules/finance/pnl";
import { usePageShortcuts } from "@/lib/keys";
import { useHydrated } from "@/lib/today";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { NotFoundPanel, RefreshFailedNotice, isMissing, loadFailed, refreshFailed } from "@/components/shell/QueryStates";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { AgentConversation, type AgentConversationHandle } from "@/components/conversation/AgentConversation";
import { useAgentDesk } from "@/components/conversation/DeskHost";
import { roleBesideName } from "@/components/conversation/logic";
import { ApprovalPanel } from "./ApprovalPanel";
import { ConfirmPlanDialog } from "./ConfirmPlanDialog";
import { SIGNOFF_NOTES_ID, SignoffPanel } from "./SignoffPanel";
import { Exhibit } from "./Exhibit";
import { readExhibit } from "./exhibits";
import { NoteTagChip } from "./InboxList";
import {
  actionStatusWord,
  agentIndex,
  answeredFrom,
  askChip,
  confirmationLines,
  decisionAttribution,
  decisionDeadline,
  decisionPastDeadline,
  followUpLinks,
  freeTextAllowed,
  goAheadState,
  hasAgentDesk,
  headerDates,
  HOLDS_CONTINUE_HINT,
  noteOpener,
  headerTag,
  hiddenNotice,
  isAlreadyDecidedMessage,
  journeyForItem,
  planConfirmationLines,
  metricKey,
  planStatusLine,
  statusStripTiles,
  stripSources,
  toDecisionOptions,
  TRAILING_MONTHS,
  type ConfirmationLine,
  signoffNeedsNotes,
} from "./logic";

type InboxGet = RouterOutputs["inbox"]["get"];
type DecideResult = RouterOutputs["inbox"]["decide"];

const DAY_MS = 86_400_000;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

/** The one-step tour on the first decision an account meets (UX plan §7.9 DecisionBar), marked done once per account. */
export const FIRST_DECISION_TOUR = "first-decision";
/** The `data-coachmark` value the pane puts on the DecisionBar's first option, where the callout points. */
export const FIRST_DECISION_TARGET = "first-decision-option";
export const FIRST_DECISION_TITLE = "Each option says what it costs and whether you can undo it";
export const FIRST_DECISION_BODY = "The recommended one is marked.";

/** The metric strip captions that are defined terms (TERMS ids), so the caption carries the definition on hover. */
export const STRIP_TERM_IDS: Readonly<Record<string, string>> = { Runway: "runway", MRR: "mrr", "Net burn": "net_burn" };

/** The strip's tiles with each defined caption wrapped in a Term (a label the glossary renamed is left as it is). */
export function tilesWithTerms(tiles: readonly MetricTileProps[]): MetricTileProps[] {
  return tiles.map((t) => (typeof t.label === "string" && STRIP_TERM_IDS[t.label] ? { ...t, label: <Term id={STRIP_TERM_IDS[t.label]!}>{t.label}</Term> } : t));
}

/** What the header's status word means, in one sentence, and the term whose "Learn more" explains it. */
export function statusWordTip(word: string): { termId: string; text: string } | null {
  if (word === "Needs your answer") return { termId: "cycle", text: "The team cannot carry on with this until you answer; the next cycle waits for it." };
  if (word === "Needs your go-ahead") return { termId: "hard_gate", text: "You chose; the plan is written and nothing in it runs until you say go." };
  return null;
}

/** An InfoTip beside the header's status word (hidden when guidance is off, like every InfoTip). */
function StatusWordTip({ word }: { word: string }) {
  const tip = statusWordTip(word);
  const def = useTerm(tip?.termId ?? "");
  if (!tip) return null;
  return (
    <InfoTip label={word} learn={def?.learn} side="bottom">
      {tip.text}
    </InfoTip>
  );
}

/** Why this decision is the founder's: a hard gate's definition for an agent's request or a sign-off, the plain reason otherwise. */
export const YOUR_DECISION_TIP = "This is yours to decide: the team carries on once you pick one, and nothing runs before that.";

function YourDecisionTip({ gated }: { gated: boolean }) {
  const hardGate = useTerm("hard_gate");
  return (
    <InfoTip label="Your decision" kind="why" learn={hardGate?.learn} side="top" className="-my-1.5">
      {gated && hardGate ? hardGate.short : YOUR_DECISION_TIP}
    </InfoTip>
  );
}

export interface ReadingPaneProps {
  itemId: string;
  onArchived?: () => void;
}

export function ReadingPane({ itemId, onArchived }: ReadingPaneProps) {
  const { businessId, departments } = useBusiness();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const currency = useBusinessCurrency();
  // An address that is not an id never reaches the API (it would answer 400 "itemId: Invalid GUID").
  const validId = isGuid(itemId);
  const getQ = useQuery(trpc.inbox.get.queryOptions({ businessId, itemId }, { staleTime: 10_000, enabled: validId }));
  const invalidate = useCallback((routers: readonly string[]) => Promise.all(routers.map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))), [queryClient]);

  // Mark read once per item (the list and the sidebar badges follow through invalidation).
  const markRead = useMutation(trpc.inbox.markRead.mutationOptions({ onSuccess: () => void invalidate(["inbox"]) }));
  const unread = getQ.data?.item.state === "unread";
  useEffect(() => {
    if (unread && !markRead.isPending && !markRead.isSuccess) markRead.mutate({ businessId, itemId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when the item turns out to be unread
  }, [unread, businessId, itemId]);

  if (!validId || (loadFailed(getQ) && isMissing(getQ.error))) {
    return (
      <NotFoundPanel bare title="Note" heading="No such note" back={{ label: "Back to the Inbox", href: routes.inbox(businessId) }}>
        This note was deleted, or the address is wrong. The list on the left has every note you can open.
      </NotFoundPanel>
    );
  }
  if (loadFailed(getQ)) return <ErrorPanel title="Note" message={errorMessage(getQ.error)} onRetry={() => void getQ.refetch()} />;
  if (!getQ.data) return <ScreenSkeleton rows={4} />;
  return (
    <>
      {refreshFailed(getQ) ? <RefreshFailedNotice query={getQ} /> : null}
      <ReadingPaneBody data={getQ.data} currency={currency} departments={departments} onArchived={onArchived} />
    </>
  );
}

/* ---------- body ---------- */

interface BodyProps {
  data: InboxGet;
  currency: string;
  departments: ReturnType<typeof useBusiness>["departments"];
  onArchived?: () => void;
}

function ReadingPaneBody({ data, currency, departments, onArchived }: BodyProps) {
  const { item, decisions, plan: storedPlan, confirmation, fromAgent, entities, approval, signoff } = data;
  const { businessId, data: biz, access } = useBusiness();
  // Guidance on: the numbers and the decided plan fold away until asked for (UX plan B19).
  const guided = useGuided();
  // A person's note: the founder's own ("You"), or someone else's, never "You".
  const sender = humanSender(item.fromUserId, biz.membership.userId);
  const senderName = sender === "self" ? "You" : sender === "other" ? NETWORK_SENDER : "Team";
  const glossary = biz.business.glossary;
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const invalidate = useCallback((routers: readonly string[]) => Promise.all(routers.map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))), [queryClient]);

  const agents = useMemo(() => agentIndex(departments), [departments]);
  const persona = fromAgent ? agents.get(fromAgent.id) : undefined;
  const department = persona ? departments.find((d) => d.id === persona.departmentId) : undefined;
  const dates = headerDates(item, decisions[0]?.decidedAt ?? null);
  const { formatDate, formatDateTime } = useFormatters();
  const hydrated = useHydrated();
  // The founder's own notes carry the founder's initials, as they do in the list ("AD"), never the letters of "You".
  const founderQ = useQuery(trpc.founder.profile.get.queryOptions(undefined, { staleTime: 5 * 60_000 }));
  const founderName = founderQ.data?.profile?.displayName?.trim() || undefined;

  // --- status strip sources (only what the note needs) ---------------------------------------------------------------
  const needs = useMemo(() => stripSources(item.statusStrip), [item.statusStrip]);
  const today = dayKey(new Date());
  const from30 = dayKey(new Date(Date.now() - 30 * DAY_MS));
  const financeQ = useQuery(trpc.finance.overview.queryOptions({ businessId }, { enabled: needs.has("finance"), staleTime: 60_000, retry: false }));
  // MRR and Revenue are the P&L revenue of the trailing three full months, as on Finance (audit OL-17).
  const wantsRevenue = useMemo(() => (Array.isArray(item.statusStrip) ? item.statusStrip : []).some((m) => ["mrr", "revenue"].includes(metricKey(String((m as { metric?: unknown } | null)?.metric ?? "")) ?? "")), [item.statusStrip]);
  const pnlRange = useMemo(() => ({ from: monthStart(new Date(), -TRAILING_MONTHS).toISOString(), to: monthStart(new Date(), 0).toISOString() }), []);
  const pnlQ = useQuery(trpc.finance.pnl.queryOptions({ businessId, ...pnlRange }, { enabled: needs.has("finance") && wantsRevenue, staleTime: 60_000, retry: false }));
  const trailingRevenue = pnlQ.data ? pnlTotals(pnlQ.data.categories).revenueMinor : null;
  const ribbonQ = useQuery(trpc.journey.ribbon.queryOptions({ businessId, from: from30, to: today }, { enabled: needs.has("conversions"), staleTime: 60_000, retry: false }));
  const tasksQ = useQuery(trpc.dev.tasks.list.queryOptions({ businessId, limit: 500 }, { enabled: needs.has("tasks"), staleTime: 30_000, retry: false }));
  const channelsQ = useQuery(trpc.distribution.channels.list.queryOptions({ businessId }, { enabled: needs.has("channels"), staleTime: 60_000, retry: false }));
  const tiles = useMemo(
    () =>
      tilesWithTerms(
        statusStripTiles(item.statusStrip, {
          finance: financeQ.data ?? null,
          trailingRevenueMinor: trailingRevenue,
          conversions: ribbonQ.data?.conversions ?? null,
          tasks: tasksQ.data?.items ?? null,
          channelsEnabled: channelsQ.data ? channelsQ.data.channels.filter((c) => c.enabled).length : null,
          glossary,
        }),
      ).map((t) => ({ ...t, loading: (needs.has("finance") && (financeQ.isLoading || (wantsRevenue && pnlQ.isLoading))) || (needs.has("conversions") && ribbonQ.isLoading) || (needs.has("tasks") && tasksQ.isLoading) || (needs.has("channels") && channelsQ.isLoading) })),
    [item.statusStrip, financeQ.data, financeQ.isLoading, trailingRevenue, wantsRevenue, pnlQ.isLoading, ribbonQ.data, ribbonQ.isLoading, tasksQ.data, tasksQ.isLoading, channelsQ.data, channelsQ.isLoading, needs, glossary],
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
  const pastDeadline = decisionPastDeadline(item.decision);
  // An agent's request: the founder's optional reason goes with Approve or Reject. A sign-off (founder, 2026-10-18): the
  // founder's notes go with Approve, and Request changes needs them.
  const [reason, setReason] = useState("");
  const [needsNotes, setNeedsNotes] = useState(false);
  const cannotAnswer = approval ? !approval.canAnswer : false;
  const [result, setResult] = useState<DecideResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The server's record wins once it has this plan (it follows another tab's confirmation and the plan's progress); the
  // decide result covers the moment before inbox.get has caught up.
  const plan = storedPlan && (!result || storedPlan.id === result.plan.id) ? storedPlan : (result?.plan ?? storedPlan);
  const answered: DecisionAnswer | undefined = useMemo(() => {
    if (result) return result.decision.chosenOption ? { optionId: result.decision.chosenOption } : result.decision.freeText ? { text: result.decision.freeText } : undefined;
    return answeredFrom(decisions);
  }, [result, decisions]);
  const isAnswered = !!answered || item.state === "answered" || item.state === "archived";
  // Who answered, for whoever reads it: "Your answer" only for the viewer's own; a co-founder sees who decided.
  const viewerId = biz.membership.userId;
  const otherDecider = !result && decisions.some((d) => d.decidedBy && d.decidedBy !== viewerId);
  const staffQ = useQuery(trpc.team.humans.list.queryOptions({ businessId }, { enabled: otherDecider, staleTime: 5 * 60_000, retry: false }));
  const attribution = useMemo(() => {
    if (result) return { label: "Your answer", by: "You", mine: true, decidedAt: result.decision.decidedAt ?? null };
    return decisionAttribution(decisions, viewerId, (userId) => {
      const m = staffQ.data?.find((s) => s.userId === userId) as ({ role: string; displayName?: string | null; email?: string | null } | undefined);
      return m ? (m.displayName || m.email || `the ${m.role}`) : null;
    });
  }, [result, decisions, viewerId, staffQ.data]);

  // A decision recorded here (an option) or in the conversation ("Go with: …", an instruction typed to the agent).
  const onDecided = useCallback(
    (res: DecideResult) => {
      setResult(res);
      // Continue follows inbox.list (AC-11.3.3); plan/dev/distribution screens follow the executed actions.
      void invalidate(["inbox", "plan", "dev", "distribution", "team", "business"]);
      if (res.approval) {
        const a = res.approval;
        toast({ title: a.outcome === "approved" ? "Approved" : "Rejected", description: `${a.summary}${a.cycle?.started ? " A cycle started." : ""}`, tone: a.outcome === "approved" ? "good" : "info", action: res.followUp ? { label: "Open the note", onClick: () => router.push(routes.inbox(businessId, res.followUp!.id)) } : undefined });
      } else if (res.requiresConfirmation) setConfirmOpen(true);
      else {
        toast({ title: "Decided", description: res.executed.length ? `${res.executed.length} action${res.executed.length === 1 ? "" : "s"} done, ${res.deferred.length} handed to the team.` : res.plan.summaryMd.slice(0, 140), tone: "good", action: res.followUp ? { label: "Open the update", onClick: () => router.push(routes.inbox(businessId, res.followUp!.id)) } : undefined });
        if (won && journeyId) router.push(routes.journey(businessId, journeyId));
      }
    },
    [invalidate, toast, router, businessId, won, journeyId],
  );
  const decide = useMutation(
    trpc.inbox.decide.mutationOptions({
      onSuccess: onDecided,
      onError: (err) => {
        // Often a view that fell behind (another tab or member decided or archived it): show what the server has now,
        // and say so as news rather than as a failure.
        void invalidate(["inbox", "plan"]);
        const message = errorMessage(err);
        if (isAlreadyDecidedMessage(message)) toast({ id: "inbox-already-decided", title: "Already decided in another tab", description: "The note now shows the answer that was recorded.", tone: "info" });
        else toast({ title: "Could not record the decision", description: message, tone: "bad" });
      },
    }),
  );
  const confirm = useMutation(
    trpc.plan.confirm.mutationOptions({
      onSuccess: (res) => {
        setConfirmOpen(false);
        setResult((prev) => (prev ? { ...prev, plan: res.plan, requiresConfirmation: false, executed: res.exec.executed, deferred: res.exec.deferred, denied: res.exec.denied, followUp: res.followUp ?? prev.followUp } : prev));
        // The note shows the confirmed plan at once (its refetch follows): no second "Review what will happen".
        queryClient.setQueryData(trpc.inbox.get.queryKey({ businessId, itemId: item.id }), (old) => (old ? { ...old, plan: res.plan, confirmation: null } : old));
        void invalidate(["inbox", "plan", "dev", "distribution", "team", "business"]);
        if (res.alreadyConfirmed) {
          toast({ title: "Already confirmed", description: "This plan was confirmed already, here or elsewhere; nothing runs twice.", tone: "info" });
          return;
        }
        toast({ title: "Confirmed", description: `${res.exec.executed.length} action${res.exec.executed.length === 1 ? "" : "s"} started${res.dispatch && !res.dispatch.queued ? "; the orchestrator is offline, the rest run when it returns" : ""}.`, tone: "good", action: res.followUp ? { label: "Open the update", onClick: () => router.push(routes.inbox(businessId, res.followUp!.id)) } : undefined });
        if (won && journeyId) router.push(routes.journey(businessId, journeyId));
      },
      onError: (err) => {
        void invalidate(["inbox", "plan"]);
        toast({ title: "Could not confirm the plan", description: errorMessage(err), tone: "bad" });
      },
    }),
  );
  const archive = useMutation(
    trpc.inbox.archive.mutationOptions({
      onSuccess: () => {
        void invalidate(["inbox"]);
        toast({ title: "Archived", tone: "info" });
        onArchived?.();
      },
      onError: (err) => {
        void invalidate(["inbox"]);
        toast({ title: "Could not archive", description: errorMessage(err), tone: "bad" });
      },
    }),
  );

  // Viewers and advisors follow the note; deciding it is for owners, admins and members (the API refuses the rest).
  const readOnly = !access.canChange;
  // Past its deadline a decision stays open: nothing on the server answers it for the founder (audit VCML-X2).
  const locked = isAnswered || readOnly || decide.isPending || confirm.isPending || cannotAnswer;
  // A second click can land before `isPending` reaches React, so one answer in flight is held in a ref.
  const deciding = useRef(false);
  const onChoose = useCallback(
    (o: DecisionOption) => {
      if (deciding.current) return;
      // Request changes on a sign-off needs the founder's words: point at the notes instead of a refused request.
      if (signoff && signoffNeedsNotes(o.id, reason)) {
        setNeedsNotes(true);
        document.getElementById(SIGNOFF_NOTES_ID)?.focus();
        return;
      }
      setNeedsNotes(false);
      deciding.current = true;
      decide.mutate({ businessId, itemId: item.id, chosenOption: o.id, ...((approval || signoff) && reason.trim() ? { freeText: reason.trim() } : {}) }, { onSettled: () => { deciding.current = false; } });
    },
    [decide, businessId, item.id, approval, signoff, reason],
  );
  // The conversation under the note (DIRECTION #6): Alt+1–4 answer the agent (1–4 stay on the options), T talks.
  const desk = useRef<AgentConversationHandle>(null);
  const showDesk = hasAgentDesk(item.type);
  const agentName = fromAgent?.name ?? "the Chief of Staff";
  useEffect(() => {
    if (!showDesk) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented || e.isComposing) return;
      if (isTypingTarget(e.target) || document.querySelector("[role=dialog], [role=alertdialog]")) return;
      e.preventDefault();
      desk.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showDesk]);
  // An agent's desk opened as a sheet over the note (the palette's Ask, a profile's Talk) owns 1–4 while it is open:
  // the note gives the keys up, so they reach the sheet's quick replies and never decide this note underneath it.
  const sheetOpen = Boolean(useAgentDesk()?.current);
  usePageShortcuts({
    onChooseOption: options.length && !locked && !sheetOpen ? (n) => {
      // Any other dialog above the note (a confirmation, the keyboard help) holds the keys too.
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      const o = options[n - 1];
      if (o && !o.disabled) onChoose(o);
    } : undefined,
  });

  // A plan waiting for its go-ahead, from the server's record: the plan that was just decided here, or the stored one
  // inbox.get hands back (after a reload, in another tab, on another device). Its lines come from the plan's own actions.
  const { waiting: pendingConfirmation, canConfirm, blockedReason } = goAheadState(plan, confirmation);
  const lines: ConfirmationLine[] = useMemo(() => (pendingConfirmation && plan ? (result?.plan.id === plan.id ? confirmationLines(result.evaluations, currency) : planConfirmationLines(plan.actions, currency)) : []), [pendingConfirmation, plan, result, currency]);
  // Nothing exists yet while the plan waits, so there is nothing to open.
  const links = useMemo(() => (plan && !pendingConfirmation ? followUpLinks(plan.actions, businessId, departments) : []), [plan, pendingConfirmation, businessId, departments]);
  const planLine = planStatusLine(plan, attribution && !attribution.mine ? attribution.by : "You");
  const roleLine = roleBesideName(fromAgent?.name ?? persona?.name, persona?.role);
  // An agent's record opens the agent's profile, every other record its CRM profile (audit GTM-19).
  const relatedEntities = entities.map((e) => ({ id: e.id, kind: e.kind as EntityKind, name: e.displayName, href: entityHref(businessId, e, (id) => agents.has(id)) }));
  // Parts of the note the reader's section permissions hide (inbox.get masks them on the server).
  const hidden = hiddenNotice(item.redacted);
  // No exhibit, no region (and no fold): the body's gap never holds an empty slot.
  const hasExhibit = useMemo(() => readExhibit(item.exhibit).kind !== "none", [item.exhibit]);
  // The header's status word, with its tip while the note still asks for something.
  const tag = headerTag(item.type, isAnswered, item.blocksContinue, pendingConfirmation);

  // The first decision an account meets: one callout on the first option (the DecisionBar's buttons carry
  // `data-option-id`; the pane marks the first as the callout's target, since the bar has no hook of its own).
  const barRef = useRef<HTMLDivElement>(null);
  const showCallout = options.length >= 2 && !isAnswered && !readOnly && item.state !== "archived";
  useEffect(() => {
    if (!showCallout) return;
    barRef.current?.querySelector<HTMLElement>("[data-option-id]")?.setAttribute("data-coachmark", FIRST_DECISION_TARGET);
  }, [showCallout, options]);

  return (
    <article className="flex min-h-0 flex-1 flex-col" data-testid="inbox-item" data-item-id={item.id} data-type={item.type} data-state={isAnswered ? "answered" : item.state}>
      {/* header */}
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-subtle bg-panel px-gutter py-2.5" data-testid="inbox-item-header">
        {persona ? <Avatar size={40} name={persona.name} agent={{ seed: persona.seed, dept: persona.dept as DeptColourToken }} /> : <Avatar size={40} name={senderName} />}
        {/* The persona column keeps a 16rem basis, so the tags wrap under it instead of crushing it. */}
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            {fromAgent ? (
              <EntityLink entity={{ id: fromAgent.id, kind: "agent", name: fromAgent.name, href: routes.agent(businessId, fromAgent.id) }} onOpen={() => router.push(routes.agent(businessId, fromAgent.id))} hoverCard={false} contextMenu={false} className="text-body-strong text-primary" data-testid="persona-link" />
            ) : (
              <span className="text-body-strong text-primary" data-testid="human-sender">{senderName}</span>
            )}
            {roleLine ? <span className="text-small text-secondary" data-testid="persona-role">{roleLine}</span> : null}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-secondary">
            {department ? (
              <DeptChip dept={department.colourToken as DeptColourToken} data-testid="department-chip">
                {department.name}
              </DeptChip>
            ) : null}
            <time dateTime={dates.created.toISOString()} title={hydrated ? formatDateTime(dates.created) : undefined} className="tabular-nums" data-testid="item-date">
              {/* The date in the person's own format ("Oct 7, 3:45 PM", "7 Oct, 15:45", "10-07 15:45"), once the browser
                  knows their time zone; the relative time beside it never changes with the format. */}
              {hydrated ? <span data-testid="item-date-absolute">{formatDate(dates.created, dates.created.getFullYear() === new Date().getFullYear() ? "dayMonthTime" : "dateTime")} · </span> : null}
              {formatRelative(dates.created)}
            </time>
            {dates.decided ? <span className="tabular-nums">· decided {formatRelative(dates.decided)}</span> : null}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <NoteTagChip tag={tag} size="header" testId="type-pill" />
          <StatusWordTip word={tag.word} />
          {item.blocksContinue && !isAnswered ? (
            <Tooltip content={HOLDS_CONTINUE_HINT}>
              <Chip tone="neutral" icon={CirclePause} data-testid="holds-continue">
                Holds Continue
              </Chip>
            </Tooltip>
          ) : null}
          {item.state !== "archived" && (isAnswered || !options.length) ? <Button size="sm" variant="ghost" icon={Archive} onClick={() => archive.mutate({ businessId, itemId: item.id })} loading={archive.isPending} data-testid="archive-item">Archive</Button> : null}
        </div>
      </header>

      {/* scrolling body */}
      <div className="flex min-h-0 flex-1 flex-col gap-gutter overflow-y-auto p-gutter [&>*]:shrink-0">
        <div className="flex flex-col gap-1.5" data-testid="inbox-title">
          {/* The subject has the full width of the pane: it wraps, it is never crushed by chips. */}
          <h1 className="t-display-md max-w-reading text-balance break-words text-primary">{item.subject}</h1>
          {hidden ? (
            <p className="flex items-center gap-1.5 text-small text-secondary" data-testid="redacted-notice">
              <EyeOff size={14} aria-hidden />
              <span>{hidden}</span>
            </p>
          ) : null}
          {relatedEntities.length ? (
            <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-small text-secondary" data-testid="related-entities">
              <span>About</span>
              {relatedEntities.slice(0, 4).map((e, i, all) => (
                <span key={e.id} className="inline-flex items-baseline">
                  <EntityLink entity={e} />
                  {i < all.length - 1 ? <span aria-hidden>,</span> : null}
                </span>
              ))}
              {relatedEntities.length > 4 ? <span>and {relatedEntities.length - 4} more</span> : null}
            </p>
          ) : null}
        </div>

        {won ? (
          <Panel title={<Term id="customer_update">Customer Update</Term>} span={12} actions={<Chip tone="gold">Win</Chip>} data-testid="customer-update">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-body text-secondary">The replay shows the first touch, who was involved, the win moment and the debrief.</p>
              <Button variant="gold" icon={Play} onClick={openReplay} disabled={!journeyId} loading={journeysQ.isLoading} data-testid="open-replay">
                Open the Customer Update
              </Button>
            </div>
            {!journeysQ.isLoading && !journeyId ? <p className="mt-2 text-small text-secondary">The replay is still being built; it appears here once the journey is recorded.</p> : null}
          </Panel>
        ) : null}

        <InboxNote bodyMd={item.bodyMd} />

        {approval ? <ApprovalPanel approval={approval} businessId={businessId} departments={departments} reason={reason} onReasonChange={setReason} answered={isAnswered || decide.isPending} /> : null}
        {signoff ? <SignoffPanel signoff={signoff} notes={reason} onNotesChange={(v) => { setReason(v); if (v.trim()) setNeedsNotes(false); }} answered={isAnswered || decide.isPending} needsNotes={needsNotes} chosenOption={answered?.optionId ?? null} /> : null}

        {tiles.length ? <StatusStrip tiles={tiles} data-testid="status-strip" /> : null}

        {hasExhibit ? (
          <Folded folded={guided} show="Show the numbers" hide="Hide the numbers" testId="exhibit-fold">
            <Exhibit exhibit={item.exhibit} entityIds={item.entityIds} fromAgentId={item.fromAgentId} currency={currency} />
          </Folded>
        ) : null}

        {isAnswered || plan ? (
          // A decision just taken here, or a plan still waiting for the go-ahead, stays open: there is something to see or do.
          <Folded folded={guided && !result && !pendingConfirmation} show="Show what happened" hide="Hide what happened" testId="answered-panel">
          <Panel title="Decided" span={12} actions={planLine ? <StatusPill tone={planLine.tone}>{planLine.word}</StatusPill> : undefined} footer={planLine ? <span>{planLine.detail}</span> : undefined} data-testid="decided-panel">
            <div className="flex flex-col gap-3">
              <KeyValueList
                items={[
                  { label: attribution?.label ?? "Your answer", value: answered?.optionId ? options.find((o) => o.id === answered.optionId)?.label ?? answered.optionId : answered?.text ? <q>{answered.text}</q> : "Recorded" },
                  ...(attribution && !attribution.mine ? [{ label: "Decided by", value: <span data-testid="decided-by">{attribution.by}{attribution.decidedAt && hydrated ? ` · ${formatDateTime(attribution.decidedAt)}` : ""}</span> }] : []),
                  ...(plan ? [{ label: "Plan", value: <Markdown variant="body">{plan.summaryMd || "No actions"}</Markdown> }] : []),
                ]}
              />
              {plan?.actions.length ? (
                <ul className="flex flex-col gap-1 text-small" data-testid="plan-actions">
                  {plan.actions.map((a) => {
                    const chip = askChip(plan, a);
                    return (
                      <li key={a.id} className="flex items-center gap-2" data-action-status={a.status}>
                        <StatusPill tone={a.status === "done" ? "good" : a.status === "failed" || a.status === "denied" ? "bad" : a.status === "awaiting_approval" || a.status === "pending" ? "warn" : "info"}>{actionStatusWord(a.status)}</StatusPill>
                        <span className="truncate">{confirmationLines([{ action: { type: a.type, params: a.params as Record<string, unknown> | null }, outcome: a.policyOutcome ?? "allow" }], currency)[0]?.label}</span>
                        {chip ? <Chip tone={chip.tone} data-testid="ask-chip">{chip.word}</Chip> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {pendingConfirmation && canConfirm ? (
                  <Button size="sm" variant="primary" icon={ShieldAlert} onClick={() => setConfirmOpen(true)} loading={confirm.isPending} data-testid="reopen-confirmation">
                    Review what will happen
                  </Button>
                ) : null}
                {pendingConfirmation && blockedReason ? (
                  <p className="text-small text-secondary text-pretty" data-testid="confirmation-blocked">
                    Waiting for someone who can give the go-ahead. {blockedReason}
                  </p>
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
          </Folded>
        ) : null}

        {showDesk ? (
          <AgentConversation
            ref={desk}
            subject={{ kind: "inbox_item", id: item.id }}
            variant="inline"
            keyModifier="alt"
            // Typed words decide only an open decision that allows free text; otherwise they stay a conversation.
            inboxReply={freeTextAllowed(item.decision) && !isAnswered && !readOnly}
            onDecision={onDecided}
            // Decided here, from the DecisionBar or in another tab: no more "Go with: …".
            decided={isAnswered}
            fallbackDept={(department?.colourToken as DeptColourToken | undefined) ?? "dept-1"}
            opener={noteOpener(item.type, options, isAnswered)}
          />
        ) : null}
      </div>

      {/* decision bar */}
      {options.length >= 2 ? (
        <DecisionBar
          ref={barRef}
          options={options}
          onChoose={onChoose}
          onAsk={showDesk ? () => desk.current?.openWrite() : undefined}
          askLabel={`Ask ${agentName}`}
          askDescription="Talk it through first"
          deadline={decisionDeadline(item.decision) ?? undefined}
          disabled={item.state === "archived" || readOnly || cannotAnswer}
          executing={decide.isPending || confirm.isPending}
          answered={answered}
          hotkeys={false}
          // The shell's keyboard map owns 1–4 here; the caps say so to operators (guidance off hides nothing else).
          keyHints
          heading={
            <span className="inline-flex items-center gap-1">
              Your decision
              <YourDecisionTip gated={!!approval || !!signoff} />
            </span>
          }
          note={
            readOnly && !isAnswered ? (
              <span className="inline-flex items-center gap-1 text-small text-secondary" data-testid="decision-read-only">
                {readOnlyReason(access)}
              </span>
            ) : pastDeadline && !isAnswered ? (
              <span className="inline-flex items-center gap-1 text-small text-status-warn" data-testid="past-deadline">
                This decision is past its deadline. The team still needs your answer, and Continue waits too.
              </span>
            ) : undefined
          }
          data-testid="decision-bar"
        />
      ) : null}
      {showCallout ? <Callout tourId={FIRST_DECISION_TOUR} targetId={FIRST_DECISION_TARGET} title={FIRST_DECISION_TITLE} body={FIRST_DECISION_BODY} side="top" /> : null}

      <ConfirmPlanDialog open={confirmOpen && pendingConfirmation} onOpenChange={setConfirmOpen} lines={lines} summary={plan?.summaryMd ?? ""} loading={confirm.isPending} onConfirm={() => plan && confirm.mutate({ businessId, planId: plan.id })} />
      {decide.isError || confirm.isError ? (
        <p className="sr-only" role="alert">
          {errorMessage(decide.error ?? confirm.error)}
        </p>
      ) : null}
    </article>
  );
}

export { ConfirmPlanDialog, type ConfirmPlanDialogProps } from "./ConfirmPlanDialog";

export interface FoldedProps {
  /** Start folded (guidance on, nothing the reader has to act on). Read once, when the region mounts, so an answer given here never folds it. */
  folded: boolean;
  /** The ghost button's words while folded ("Show the numbers") and while open ("Hide the numbers"). */
  show: string;
  hide: string;
  /** The wrapper's test id; the button carries `<testId>-toggle`. */
  testId?: string;
  children: ReactNode;
}

/**
 * A region that starts folded under a ghost disclosure while guidance is on (UX plan B19): the button sits exactly
 * where the content sits (DOM order unchanged), and opening it draws the content in place. Not folded: the content as
 * is, no button. TODO(guided-layer): swap for the shared disclosure primitive once it lands.
 */
export function Folded({ folded, show, hide, testId, children }: FoldedProps) {
  const [foldable] = useState(folded);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  if (!foldable) return <div data-testid={testId}>{children}</div>;
  return (
    <div data-testid={testId} data-folded={!open || undefined}>
      <Button size="sm" variant="ghost" icon={open ? ChevronDown : ChevronRight} aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)} data-testid={testId ? `${testId}-toggle` : undefined}>
        {open ? hide : show}
      </Button>
      {open ? (
        <div id={bodyId} className="mt-2">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The note body in the reading style, with the first mention of each defined term carrying its definition on hover
 * (Markdown `terms`; off while guidance is off). Dugout's Markdown keeps its own props, so the test id lives on this
 * wrapper.
 */
export function InboxNote({ bodyMd }: { bodyMd: string }) {
  return (
    <div data-testid="inbox-note">
      <Markdown variant="reading" className="t-reading" terms>
        {bodyMd}
      </Markdown>
    </div>
  );
}
