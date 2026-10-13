"use client";
/**
 * Talking to an agent at their desk (audit-conversation §4, DIRECTION #6) for any subject: an Inbox note, the agent
 * itself (its profile, the command palette) or one of its tasks. Wraps Dugout's AgentDesk with `agent.conversation.*`:
 *
 *   - `get` gives the persona (presence, current task, voice), the thread and the starters: no model call, so the
 *     quick replies are there at once.
 *   - A quick reply or typed text goes to `send` (Inbox notes: typed text goes to `inboxReply`, so a question never
 *     uses up the decision). The founder's bubble appears at once ("Sending…"), the agent types while the reply is
 *     genuinely in flight, and the reply is merged into the cache (no refetch).
 *   - "Go with: …" decides through the existing decide path (`onDecision`); "Review the plan" stages the hand-off and
 *     opens "Here is what will happen"; only `plan.confirm` runs it. "Take a break" pauses the agent's running task
 *     through `dev.tasks.pause`, acknowledged in the agent's own voice (no model call).
 *   - A send that fails (the api is down, the model failed, a limit, a chip that is no longer open) keeps the founder's
 *     words on screen ("Not sent") and the agent says what happened in its own voice, with "Try again" first among the
 *     replies; nothing is resent without a press. One send at a time: a second press while one is in flight does nothing.
 *   - Once the item is decided (`decided`), no "Go with: …" is offered any more.
 *
 * Nothing here decides what is allowed: the server applies the house rules and hard gates to every reply and plan.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { AgentDesk, Button, EntityText, Markdown, Skeleton, useToast, type AgentDeskVariant, type DeskMessage, type QuickReplyItem } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { errorMessage, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import { provideAgentConversation } from "./DeskHost";
import { ConfirmPlanDialog } from "@/components/inbox/ConfirmPlanDialog";
import { confirmationLines } from "@/components/inbox/confirmation";
import { currentQuickReplies } from "@foundmill/dugout";
import {
  FAILURE_PREFIX,
  RETRY_REPLY_ID,
  TAKE_A_BREAK_ID,
  bubbleNeedsMarkdown,
  deskFailureOf,
  deskMessagesOf,
  deskPersonaOf,
  failureQuickReplies,
  failureReply,
  openFailureLine,
  roleBesideName,
  sayOf,
  voiceAck,
  withPlanId,
  withSent,
  withoutChoices,
  type ConversationSend,
  type ConversationSubject,
  type HandOffPreview,
} from "./logic";

export type DecideResult = RouterOutputs["inbox"]["decide"];

/** Render one bubble: mentions through EntityText (plain underlined links), Markdown only when the bubble needs it. */
export function renderBubble(text: string): ReactNode {
  return bubbleNeedsMarkdown(text) ? <Markdown variant="body">{text}</Markdown> : <EntityText>{text}</EntityText>;
}

export interface AgentConversationHandle {
  /** Bring the desk into view and open its Write field (the DecisionBar's "Ask <agent>"). */
  openWrite: () => void;
  /** Bring the desk into view and focus the thread (T). */
  focus: () => void;
}

export interface AgentConversationProps {
  subject: ConversationSubject;
  variant?: AgentDeskVariant;
  /** Sheet only. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** "alt" in the Inbox, where 1–4 belong to the decision options. */
  keyModifier?: "none" | "alt";
  hotkeys?: boolean;
  /** Inbox notes: typed text goes through `inboxReply` (questions stay in the conversation, instructions decide). */
  inboxReply?: boolean;
  /** "Go with: …" (or an instruction typed in the Inbox) decided the item: show the outcome / the confirmation. */
  onDecision?: (decision: DecideResult) => void;
  /** The Inbox item is decided (here or from the DecisionBar): "Go with: …" is no longer offered. */
  decided?: boolean;
  /** The agent's colour when it has no department of its own. */
  fallbackDept?: DeptColourToken;
  /** Sheet only: the line under the band ("About: …"). */
  subjectLine?: ReactNode;
  /** Sent once as the founder's first message when the desk opens (the palette's "Ask Juno · why is cash down?"). */
  initialText?: string | null;
  /** Called after `initialText` was handed to the desk. */
  onInitialTextSent?: () => void;
  /**
   * The agent's first line while the thread is empty, in place of its generic greeting: an Inbox note's own subject
   * ("I'd go with “Approve”. Ask me anything before you decide."). No model call.
   */
  opener?: string | null;
  /** Sheet only: who the founder is talking to, so the sheet opens at once while the desk loads. */
  personaHint?: { name: string; role?: string | null; avatarSeed: string; dept?: DeptColourToken | null } | null;
  className?: string;
}

interface Outgoing {
  /** The optimistic bubble's id (kept once the server has the message, so it never re-arrives). */
  localId: string;
  /** What the founder's bubble says (a retry resends exactly this). */
  words?: string;
  text?: string;
  quickReplyId?: string;
  /** The option the pressed chip names on screen (sent with it, so a chip that now names another option is refused). */
  optionId?: string | null;
}

/** The nearest ancestor of `el` that scrolls. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/**
 * Bring `el` into view, clear of the Inbox's sticky DecisionBar when it floats over the bottom of the same scroller (its
 * height grows with the options), so the newest reply, its quick replies and the Write field are never hidden behind it.
 * The scroller is moved directly: `scrollIntoView` clips the target to the reading pane's own (non-scrolling) overflow box
 * and ignores the room the bar takes. Instant on purpose: a smooth page scroll is cancelled by the thread's own smooth
 * scroll to its newest bubble.
 */
function revealAboveBar(el: HTMLElement | null | undefined): void {
  if (!el) return;
  const scroller = scrollerOf(el);
  if (!scroller) {
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    return;
  }
  const bar = el.closest("article")?.querySelector<HTMLElement>('[data-testid="decision-bar"]');
  const box = scroller.getBoundingClientRect();
  const covered = bar ? Math.max(0, box.bottom - bar.getBoundingClientRect().top) : 0;
  const top = box.top + 12;
  const bottom = box.bottom - covered - 12;
  const r = el.getBoundingClientRect();
  // Taller than the room left: show its top. Otherwise bring its bottom up to the room's bottom, or its top down.
  const delta = r.height > bottom - top ? r.top - top : r.bottom > bottom ? r.bottom - bottom : r.top < top ? r.top - top : 0;
  if (delta !== 0) scroller.scrollBy({ top: delta, behavior: "auto" });
}

let localSeq = 0;
const nextLocalId = () => `local-${Date.now().toString(36)}-${(localSeq++).toString(36)}`;

export const AgentConversation = forwardRef<AgentConversationHandle, AgentConversationProps>(function AgentConversation(
  { subject, variant = "inline", open = true, onOpenChange, keyModifier = "none", hotkeys = true, inboxReply = false, onDecision, decided = false, fallbackDept = "dept-1", subjectLine, initialText, onInitialTextSent, personaHint, opener, className },
  ref,
) {
  const { businessId } = useBusiness();
  const currency = useBusinessCurrency();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const input = useMemo(() => ({ businessId, subject: { kind: subject.kind, id: subject.id } }), [businessId, subject.kind, subject.id]);
  const getQ = useQuery(trpc.agent.conversation.get.queryOptions(input, { staleTime: 60_000, enabled: variant !== "sheet" || open }));
  const key = trpc.agent.conversation.get.queryKey(input);
  const view = getQ.data;

  // Optimistic founder bubbles (sending / failed) and local acknowledgements, until the server's messages replace them.
  const [local, setLocal] = useState<DeskMessage[]>([]);
  const outgoing = useRef(new Map<string, Outgoing>());
  const alias = useRef(new Map<string, string>());
  const [pendingReplyId, setPendingReplyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<HandOffPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const invalidate = useCallback((routers: readonly string[]) => Promise.all(routers.map((r) => queryClient.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] }))), [queryClient]);

  const sendM = useMutation(trpc.agent.conversation.send.mutationOptions());
  const replyM = useMutation(trpc.agent.conversation.inboxReply.mutationOptions());
  const handOffM = useMutation(trpc.agent.conversation.handOff.mutationOptions());
  const pauseM = useMutation(trpc.dev.tasks.pause.mutationOptions());
  const confirmM = useMutation(
    trpc.plan.confirm.mutationOptions({
      onSuccess: (res) => {
        setConfirmOpen(false);
        setPreview(null);
        void invalidate(["inbox", "plan", "dev", "distribution", "team", "business"]);
        void queryClient.invalidateQueries({ queryKey: key });
        toast({ title: "Confirmed", description: `${res.exec.executed.length} action${res.exec.executed.length === 1 ? "" : "s"} started${res.exec.deferred.length ? `, ${res.exec.deferred.length} handed to the team` : ""}.`, tone: "good" });
      },
      onError: (err) => toast({ title: "Could not confirm the plan", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const replying = sendM.isPending || replyM.isPending;

  const merge = useCallback(
    (sent: Pick<ConversationSend, "thread" | "messages" | "quickReplies">, localId: string) => {
      // The founder's message keeps its optimistic id on screen: it never re-arrives.
      const founder = sent.messages.find((m) => m.author === "founder");
      if (founder) alias.current.set(founder.id, localId);
      queryClient.setQueryData(key, (old) => (old ? withSent(old, sent) : old));
      setLocal((l) => l.filter((m) => m.id !== localId));
    },
    [queryClient, key],
  );

  const showPreview = useCallback((p: HandOffPreview) => {
    setPreview(p);
    setConfirmOpen(true);
    queryClient.setQueryData(key, (old) => (old ? withPlanId(old, p.messageId, p.planId) : old));
  }, [queryClient, key]);

  // One send at a time (a double press, a key held down, Enter and a click together): the ref answers before React does.
  const inFlight = useRef(false);
  // The founder has said something at this desk (the inline desk then keeps the newest exchange in view).
  const spoke = useRef(false);
  /**
   * The founder's message stays ("Not sent") and the agent says what happened, in its own voice, with "Try again"
   * first when a retry can help and what was on offer before after it. A chip that is no longer open refreshes the desk.
   */
  const failed = useCallback(
    (out: Outgoing, err: unknown, what?: string) => {
      const { kind, message } = deskFailureOf(err);
      const reply = failureReply(kind, message);
      if (what && kind === "failed") reply.bubbles[0] = what;
      const retry = reply.retry && outgoing.current.has(out.localId);
      const before = view ? currentQuickReplies(deskMessagesOf(view), view.starters) : [];
      const quickReplies = failureQuickReplies(retry, before, out.quickReplyId ?? null, decided);
      setLocal((l) => [
        ...l.filter((m) => !m.id.startsWith(FAILURE_PREFIX)).map((m) => (m.id === out.localId ? { ...m, state: "failed" as const } : m)),
        { id: `${FAILURE_PREFIX}${out.localId}`, author: "agent", bubbles: reply.bubbles, at: new Date(), reaction: "concerned", quickReplies },
      ]);
      if (!retry) {
        outgoing.current.delete(out.localId);
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    [view, decided, queryClient, key],
  );

  const deliver = useCallback(
    (out: Outgoing) => {
      inFlight.current = true;
      spoke.current = true;
      // A refetch landing mid-send would show the founder's message twice (stored + optimistic) for a moment.
      void queryClient.cancelQueries({ queryKey: key });
      const settle = () => {
        inFlight.current = false;
        setPendingReplyId(null);
      };
      // Promises, not per-call callbacks: the reply still reaches the cache if the founder moves on before it arrives.
      const job: Promise<void> =
        inboxReply && out.text && subject.kind === "inbox_item"
          ? replyM.mutateAsync({ businessId, itemId: subject.id, text: out.text }).then((res) => {
              outgoing.current.delete(out.localId);
              if (res.route === "decision") {
                // An instruction: it answered the note through the decide path (nothing is said in the thread).
                setLocal((l) => l.filter((m) => m.id !== out.localId));
                onDecision?.(res.decision);
                return;
              }
              merge(res, out.localId);
              if (res.decision) onDecision?.(res.decision);
              if (res.handOff) showPreview(res.handOff);
            })
          : sendM.mutateAsync({ businessId, subject: input.subject, ...(out.quickReplyId ? { quickReplyId: out.quickReplyId, ...(out.optionId !== undefined ? { optionId: out.optionId } : {}) } : { text: out.text! }) }).then((res) => {
              outgoing.current.delete(out.localId);
              merge(res, out.localId);
              if (res.decision) onDecision?.(res.decision);
              if (res.handOff) showPreview(res.handOff);
            });
      void job.catch((err: unknown) => failed(out, err)).finally(settle);
    },
    [queryClient, key, inboxReply, subject.kind, subject.id, replyM, sendM, businessId, input.subject, merge, onDecision, showPreview, failed],
  );

  const post = useCallback(
    (words: string, payload: Omit<Outgoing, "localId">) => {
      if (inFlight.current || replying) return;
      const localId = nextLocalId();
      const out = { localId, words, ...payload };
      outgoing.current.set(localId, out);
      // Sending something else lets go of a message that was not sent (and the agent's word about it).
      setLocal((l) => [...l.filter((m) => m.state !== "failed" && !m.id.startsWith(FAILURE_PREFIX)), { id: localId, author: "founder", bubbles: [words], at: new Date(), state: "sending" }]);
      deliver(out);
    },
    [replying, deliver],
  );

  const persona = view?.persona;
  const takeABreak = useCallback(
    (reply: QuickReplyItem) => {
      const task = persona?.currentTask;
      if (!task) return post(sayOf(reply), { quickReplyId: reply.id, optionId: reply.option_id });
      if (inFlight.current) return;
      inFlight.current = true;
      spoke.current = true;
      const localId = nextLocalId();
      const out: Outgoing = { localId, words: sayOf(reply), quickReplyId: TAKE_A_BREAK_ID };
      outgoing.current.set(localId, out);
      setPendingReplyId(reply.id);
      setLocal((l) => [...l.filter((m) => m.state !== "failed" && !m.id.startsWith(FAILURE_PREFIX)), { id: localId, author: "founder", bubbles: [sayOf(reply)], at: new Date(), state: "sending" }]);
      pauseM
        .mutateAsync({ businessId, taskId: task.id })
        .then(() => {
          outgoing.current.delete(localId);
          const at = new Date();
          // The agent's acknowledgement in its own voice: deterministic, no model call.
          setLocal((l) => [...l.map((m) => (m.id === localId ? { ...m, state: "seen" as const } : m)), { id: `${localId}-ack`, author: "agent", bubbles: [`${voiceAck(persona.voice, `${task.id}:${localId}`)} Pausing ${task.title} now.`], at, reaction: "noted", quickReplies: [] }]);
          void invalidate(["dev", "team", "cycle"]);
          void queryClient.invalidateQueries({ queryKey: key });
          toast({ title: "Paused", description: `${persona.name} has stopped work on ${task.title}. Resume it from Development.`, tone: "info" });
        })
        .catch((err: unknown) => failed(out, err, `I couldn't pause ${task.title} just then.`))
        .finally(() => {
          inFlight.current = false;
          setPendingReplyId(null);
        });
    },
    [persona, post, pauseM, businessId, invalidate, queryClient, key, toast, failed],
  );

  const onRetry = useCallback(
    (localId: string) => {
      const out = outgoing.current.get(localId);
      if (!out || inFlight.current || replying) return;
      if (out.quickReplyId === TAKE_A_BREAK_ID) {
        // Pausing is not a message to the model: press it again (the failed bubble makes way for the new one).
        outgoing.current.delete(localId);
        return takeABreak({ id: TAKE_A_BREAK_ID, label: "Take a break", say: out.words });
      }
      setLocal((l) => l.filter((m) => !m.id.startsWith(FAILURE_PREFIX)).map((m) => (m.id === localId ? { ...m, state: "sending" } : m)));
      if (out.quickReplyId) setPendingReplyId(out.quickReplyId);
      deliver(out);
    },
    [deliver, replying, takeABreak],
  );

  const onQuickReply = useCallback(
    (reply: QuickReplyItem) => {
      if (inFlight.current || replying || pauseM.isPending) return;
      if (reply.id === RETRY_REPLY_ID) {
        const failedId = [...local].reverse().find((m) => m.state === "failed" && outgoing.current.has(m.id))?.id;
        if (failedId) onRetry(failedId);
        return;
      }
      if (reply.id === TAKE_A_BREAK_ID) return takeABreak(reply);
      setPendingReplyId(reply.id);
      post(sayOf(reply), { quickReplyId: reply.id, optionId: reply.option_id });
    },
    [replying, pauseM.isPending, local, onRetry, takeABreak, post],
  );

  const onSend = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      post(t, { text: t });
    },
    [post],
  );

  const onHandOff = useCallback(
    (messageId: string) => {
      handOffM.mutate(
        { businessId, messageId },
        {
          onSuccess: (p) => showPreview(p),
          onError: (err) => toast({ title: "Could not prepare the plan", description: errorMessage(err), tone: "bad" }),
        },
      );
    },
    [handOffM, businessId, showPreview, toast],
  );

  // The palette's "Ask <agent> · <question>": the question is the founder's first message, sent once the desk is ready.
  const initialSent = useRef(false);
  useEffect(() => {
    if (!view || initialSent.current || !initialText?.trim()) return;
    initialSent.current = true;
    onSend(initialText);
    onInitialTextSent?.();
  }, [view, initialText, onSend, onInitialTextSent]);

  // --- handle (DecisionBar "Ask <agent>", T) --------------------------------------------------------------------------
  const rootRef = useRef<HTMLDivElement>(null);
  const deskEl = useCallback((): HTMLElement | null => {
    if (variant === "sheet") return document.querySelector<HTMLElement>(`[data-testid="agent-desk"][data-variant="sheet"]`);
    return rootRef.current?.querySelector<HTMLElement>(`[data-testid="agent-desk"]`) ?? rootRef.current;
  }, [variant]);
  // "Ask <agent>" pressed before the desk has loaded: open the Write field as soon as it is there.
  const writeWanted = useRef(false);
  const openWrite = useCallback(() => {
    const el = deskEl();
    const write = el?.querySelector<HTMLButtonElement>('[data-quick-reply="write"]');
    if (!el || !el.querySelector('[data-testid="desk-thread"]')) {
      writeWanted.current = true;
      revealAboveBar(el);
      return;
    }
    writeWanted.current = false;
    if (write && !write.disabled) write.click();
    else el.querySelector<HTMLElement>('[data-testid="desk-thread"]')?.focus({ preventScroll: true });
    // The field (or the replies) above the DecisionBar once it has rendered.
    requestAnimationFrame(() => revealAboveBar(el.querySelector<HTMLElement>('[data-testid="desk-replies"]') ?? el));
  }, [deskEl]);
  const ready = Boolean(view);
  useEffect(() => {
    if (!ready || !writeWanted.current) return;
    const raf = requestAnimationFrame(() => openWrite());
    return () => cancelAnimationFrame(raf);
  }, [ready, openWrite]);
  useImperativeHandle(
    ref,
    () => ({
      openWrite,
      focus: () => {
        const el = deskEl();
        if (!el) return;
        revealAboveBar(variant === "sheet" ? null : (el.querySelector<HTMLElement>('[data-testid="desk-replies"]') ?? el));
        el.querySelector<HTMLElement>('[data-testid="desk-thread"]')?.focus({ preventScroll: true });
      },
    }),
    [deskEl, openWrite, variant],
  );

  const messages = useMemo<DeskMessage[]>(() => withoutChoices(view ? [...deskMessagesOf(view, alias.current), ...local] : local, decided), [view, local, decided]);
  const starters = useMemo(() => (view ? (decided ? view.starters.filter((q) => q.kind !== "choose_option") : view.starters) : []), [view, decided]);
  // Decided from the DecisionBar (or another tab): the server's view drops "Go with" too, so read it again once.
  useEffect(() => {
    if (decided) void queryClient.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the decision lands
  }, [decided]);

  // Inline in a page (the Inbox): once the founder has said something here, the conversation follows itself: their
  // bubble, the typing line, the reply and its new quick replies stay in view above the DecisionBar. Nothing scrolls
  // before the founder speaks (opening a note never jumps past it).
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (variant === "sheet" || !spoke.current) return;
    const strip = rootRef.current?.querySelector<HTMLElement>('[data-testid="desk-replies"]');
    if (!strip) return;
    const raf = requestAnimationFrame(() => revealAboveBar(strip));
    return () => cancelAnimationFrame(raf);
  }, [lastId, messages.length, variant, replying]);
  const lines = useMemo(() => (preview ? confirmationLines(preview.evaluations, currency) : []), [preview, currency]);

  const label = persona ? `Conversation with ${persona.name}` : "Conversation";
  const dialog = <ConfirmPlanDialog open={confirmOpen} onOpenChange={setConfirmOpen} lines={lines} summary={preview?.summary ?? ""} loading={confirmM.isPending} onConfirm={() => preview && confirmM.mutate({ businessId, planId: preview.planId })} />;

  if (!view || !persona) {
    if (variant === "sheet") {
      if (!personaHint) return null;
      // The sheet opens at once with who the founder is talking to; the thread and replies follow from `get`.
      return (
        <AgentDesk
          persona={{ id: subject.id, name: personaHint.name, role: roleBesideName(personaHint.name, personaHint.role) ?? "", avatarSeed: personaHint.avatarSeed, dept: personaHint.dept ?? fallbackDept }}
          messages={[]}
          onQuickReply={() => undefined}
          onSend={() => undefined}
          variant="sheet"
          greeting={false}
          disabled
          disabledNote={
            getQ.error ? (
              <span className="flex flex-wrap items-center gap-2" role="alert">
                <span>{openFailureLine(getQ.error)}</span>
                <Button size="sm" onClick={() => void getQ.refetch()}>
                  Try again
                </Button>
              </span>
            ) : (
              <span aria-busy="true">Opening the conversation…</span>
            )
          }
          label={`Conversation with ${personaHint.name}`}
          open={open}
          onOpenChange={onOpenChange}
          subject={subjectLine}
          className={className}
        />
      );
    }
    return (
      <div ref={rootRef} className={className} data-testid="agent-conversation" data-state={getQ.error ? "error" : "loading"}>
        {getQ.error ? (
          <div className="surface-panel flex flex-wrap items-center gap-3 p-panel-pad text-small text-secondary" role="alert">
            <span className="min-w-0 flex-1">{openFailureLine(getQ.error)}</span>
            <Button size="sm" onClick={() => void getQ.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="surface-panel flex gap-4 p-panel-pad" aria-busy="true" aria-label="Opening the conversation">
            <div className="flex w-36 flex-col items-center gap-2">
              <Skeleton className="size-16" shape="circle" index={0} />
              <Skeleton className="h-3 w-20" index={1} />
              <Skeleton className="h-2.5 w-24" index={2} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-end gap-2.5">
              <Skeleton className="h-9 w-3/5 rounded-lg" index={3} />
              <div className="flex gap-2">
                <Skeleton className="h-control-md w-36 rounded-sm" index={4} />
                <Skeleton className="h-control-md w-28 rounded-sm" index={5} />
                <Skeleton className="h-control-md w-32 rounded-sm" index={6} />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const deskPersona = deskPersonaOf(persona, fallbackDept);
  const desk = (
    <AgentDesk
      persona={opener ? { ...deskPersona, voice: { ...deskPersona.voice, greeting: opener } } : deskPersona}
      messages={messages}
      starters={starters}
      onQuickReply={onQuickReply}
      onSend={onSend}
      onHandOff={onHandOff}
      replying={replying}
      renderBubble={renderBubble}
      variant={variant}
      hotkeys={hotkeys && !confirmOpen}
      keyModifier={keyModifier}
      pendingReplyId={pendingReplyId}
      label={label}
      open={open}
      onOpenChange={onOpenChange}
      subject={subjectLine}
      className={variant === "sheet" ? className : undefined}
    />
  );

  if (variant === "sheet") {
    return (
      <>
        {desk}
        {dialog}
      </>
    );
  }
  return (
    <div ref={rootRef} className={className} data-testid="agent-conversation" data-state="ready" data-subject-kind={subject.kind}>
      {desk}
      {dialog}
    </div>
  );
});

// The sheet host loads this module on demand; a page that imports it directly (the Inbox) hands it over instead.
provideAgentConversation({ AgentConversation });
