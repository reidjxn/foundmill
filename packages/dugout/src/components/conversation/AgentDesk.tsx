"use client";
import {
  Fragment,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ListChecks, Lock, RotateCcw, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { usePrefersReducedMotion } from "../../lib/reducedMotion";
import { Avatar } from "../foundation/Avatar";
import { Button } from "../foundation/Button";
import { useDateFormat } from "../foundation/DateFormatProvider";
import { Skeleton } from "../foundation/Skeleton";
import { Icon } from "../foundation/Icon";
import { FocusOrigin, useReturnFocus } from "../foundation/ReturnFocus";
import { DeskPresence } from "./DeskPresence";
import { QuickReplies, isTypingTarget, type QuickReplyKeyModifier } from "./QuickReplies";
import { Reaction } from "./Reaction";
import { ReadReceipt } from "./ReadReceipt";
import { StreamingText } from "./StreamingText";
import { TypingLine } from "./TypingLine";
import {
  FALLBACK_QUICK_REPLIES,
  OPENING_FALLBACK_REPLIES,
  currentQuickReplies,
  founderTurn,
  groupMessages,
  presenceWords,
  reactionsByFounderMessage,
  readTimesByFounderMessage,
  thinkingPhraseFor,
  toneClass,
  type DeskMessage,
  type DeskPersona,
  type QuickReplyItem,
} from "./types";

export type AgentDeskVariant = "inline" | "sheet" | "compact";

export interface AgentDeskProps {
  persona: DeskPersona;
  messages: readonly DeskMessage[];
  /** Deterministic openers shown before the first message (no model call): "Why that one?", "What's the risk?". */
  starters?: readonly QuickReplyItem[];
  /** A quick reply was pressed (or its number key). `write` replies open the field instead. */
  onQuickReply: (reply: QuickReplyItem) => void;
  /** The founder typed something (the Write field, or a fallback reply). Return a promise to keep the field busy. */
  onSend: (text: string) => void | Promise<unknown>;
  /** Review an agent message's hand-off (stage the plan). Omit when the founder cannot act on it. */
  onHandOff?: (messageId: string) => void;
  /** Resend a founder message that failed. */
  onRetry?: (messageId: string) => void;
  /** The agent's reply is genuinely in flight: the typing line shows and the quick replies wait. */
  replying?: boolean;
  /** What the agent is looking at while it types. Defaults to the voice's thinking line or the current task. */
  thinkingPhrase?: string | null;
  /** Render a bubble's Markdown and `[[ent:…]]` mentions (EntityText). Plain text without it. */
  renderBubble?: (markdown: string) => ReactNode;
  /** inline: a page section with the presence column. sheet: a right-side sheet. compact: narrow places. */
  variant?: AgentDeskVariant;
  /** Number keys send quick replies. Default true. */
  hotkeys?: boolean;
  /** "alt" in the Inbox, where 1–4 belong to the DecisionBar. */
  keyModifier?: QuickReplyKeyModifier;
  /** The founder cannot reply here (no write access, or the thread is closed): no quick replies, no field. */
  disabled?: boolean;
  /** Why, shown where the replies would be. */
  disabledNote?: ReactNode;
  /** The quick reply being sent (pressed look). */
  pendingReplyId?: string | null;
  /** Open an empty thread with the agent's own greeting. Default true. */
  greeting?: boolean;
  /** The conversation's accessible name: "Conversation with Juno". */
  label: string;
  /** Sheet only: open state. Default open. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Sheet only: a line under the band, e.g. the subject ("About: Boots UK wants a 40-store trial"). */
  subject?: ReactNode;
  className?: string;
  /** The root's test id. Default "agent-desk". */
  testId?: string;
}

interface Row {
  message: DeskMessage;
  bubble: string;
  index: number;
  lastOfMessage: boolean;
}

function rowsOf(messages: readonly DeskMessage[]): Row[] {
  return messages.flatMap((message) => {
    const bubbles = message.bubbles.length ? message.bubbles : [""];
    return bubbles.map((bubble, index) => ({
      message,
      bubble,
      index,
      lastOfMessage: index === bubbles.length - 1,
    }));
  });
}

const GREETING_ID = "desk-greeting";

/**
 * Talking to an agent at their desk (DIRECTION #6, audit-conversation §4): the agent's presence (live portrait, name,
 * role, state, what they are doing now) beside the thread; founder bubbles right in brand glass with a read receipt;
 * agent bubbles left in the department's tint, a reply's bubbles arriving 120 ms apart; the agent's reaction as an icon
 * disc; a typing line that names what the agent is looking at; and 2–4 quick replies whenever it is the founder's turn,
 * so they never have to type (a ghost Write is there if they want to).
 *
 * It never acts: quick replies, typed text and hand-offs go to the caller, and the server decides what is allowed
 * (house rules, hard gates). Agents never claim to be human; the presence carries an "AI agent" marker.
 */
export function AgentDesk(props: AgentDeskProps) {
  const {
    persona,
    messages,
    starters = [],
    onQuickReply,
    onSend,
    replying = false,
    variant = "inline",
    hotkeys = true,
    keyModifier = "none",
    disabled = false,
    disabledNote,
    pendingReplyId = null,
    label,
    open = true,
    onOpenChange,
    subject,
    className,
    testId = "agent-desk",
  } = props;

  const yourTurn = !replying && founderTurn(messages);
  const offered = yourTurn ? currentQuickReplies(messages, starters) : [];
  // The founder never has to type: with nothing on offer, generic replies stand in (sent as text).
  const replies =
    yourTurn && offered.length === 0
      ? messages.length
        ? FALLBACK_QUICK_REPLIES.slice(0, 2)
        : OPENING_FALLBACK_REPLIES
      : offered;

  // The sheet hands focus back to whatever opened it when it closes.
  const returnFocus = useReturnFocus();
  // Keyboard continuity: a reply pressed from the keyboard unmounts with the strip; keep focus in the conversation.
  const threadRef = useRef<HTMLDivElement>(null);
  const focusInStrip = useRef(false);
  useEffect(() => {
    if (yourTurn || !focusInStrip.current) return;
    focusInStrip.current = false;
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (!active || active === document.body) threadRef.current?.focus({ preventScroll: true });
  }, [yourTurn]);
  const keysOn = hotkeys && !disabled && yourTurn && (variant !== "sheet" || open);

  const repliesStrip = (
    <div
      className="desk-replies"
      data-testid="desk-replies"
      onFocus={() => {
        focusInStrip.current = true;
      }}
      onBlur={(e) => {
        // Focus moving elsewhere on the page clears the flag; a pressed reply unmounting (no related target) does not.
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget))
          focusInStrip.current = false;
      }}
    >
      {disabled ? (
        disabledNote ? (
          <p className="text-small text-tertiary">{disabledNote}</p>
        ) : null
      ) : yourTurn ? (
        <QuickReplies
          replies={replies}
          onChoose={onQuickReply}
          onSend={onSend}
          agentName={persona.name}
          hotkeys={keysOn}
          keyModifier={keyModifier}
          pendingId={pendingReplyId}
        />
      ) : (
        // While the agent replies, the next replies are being prepared: quiet placeholders hold the strip's height.
        <div aria-hidden className="quick-replies" data-testid="desk-replies-waiting">
          <Skeleton className="h-control-md w-36 rounded-sm" index={0} />
          <Skeleton className="h-control-md w-28 rounded-sm" index={1} />
          <Skeleton className="h-control-md w-32 rounded-sm" index={2} />
        </div>
      )}
    </div>
  );

  const thread = <DeskThread {...props} variant={variant} threadRef={threadRef} />;

  if (variant === "sheet") {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="backdrop-motion fixed inset-0 z-50 bg-backdrop backdrop-blur-dialog" />
          <DialogPrimitive.Content
            className={cn(
              "desk desk-sheet text-body text-primary",
              toneClass(persona.dept),
              className,
            )}
            data-variant="sheet"
            data-testid={testId}
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              // Focus the sheet itself: not the thread (a ring round everything) and not a reply that Enter would send.
              e.preventDefault();
              (e.currentTarget as HTMLElement | null)?.focus();
            }}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
            onEscapeKeyDown={(e) => {
              // Escape in the Write field closes the field, not the sheet.
              if (isTypingTarget(e.target)) e.preventDefault();
            }}
          >
            <FocusOrigin origin={returnFocus.origin} />
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
            <DeskPresence persona={persona} replying={replying} layout="band" surface="surface-3" />
            {subject ? (
              <div className="px-gutter pt-3 text-small text-tertiary">{subject}</div>
            ) : null}
            {thread}
            {repliesStrip}
            <DialogPrimitive.Close
              aria-label="Close"
              data-dialog-close
              className="absolute right-3 top-3 inline-flex size-control-sm items-center justify-center rounded-sm text-tertiary transition-colors duration-hover ease-out hover:bg-white/8 hover:text-primary focus-ring"
            >
              <Icon icon={X} />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  if (variant === "compact") {
    return (
      <section
        aria-label={label}
        className={cn("desk surface-panel glow-dept edge-tint", toneClass(persona.dept), className)}
        data-variant="compact"
        data-testid={testId}
      >
        <DeskPresence persona={persona} replying={replying} layout="head" />
        {thread}
        {repliesStrip}
      </section>
    );
  }

  return (
    <section
      aria-label={label}
      className={cn("desk surface-panel glow-dept edge-tint", toneClass(persona.dept), className)}
      data-variant="inline"
      data-testid={testId}
    >
      <div className="desk-body">
        <DeskPresence persona={persona} replying={replying} layout="column" />
        {thread}
      </div>
      {repliesStrip}
    </section>
  );
}

/** The thread: grouped bubbles, receipts, reactions, hand-offs and the typing line; it follows the newest message. */
function DeskThread({
  persona,
  messages,
  replying = false,
  thinkingPhrase,
  renderBubble,
  variant = "inline",
  onHandOff,
  onRetry,
  disabled = false,
  greeting = true,
  label,
  threadRef,
}: AgentDeskProps & { variant: AgentDeskVariant; threadRef: RefObject<HTMLDivElement | null> }) {
  const reduced = usePrefersReducedMotion();
  const datePrefs = useDateFormat();
  const ref = threadRef;
  // Messages already here when the desk opened are history: they render settled. Later ones arrive.
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(messages.map((m) => m.id));

  const portraits = variant !== "inline";
  const greetingText =
    greeting && messages.length === 0 ? persona.voice?.greeting?.trim() : undefined;
  const shown: readonly DeskMessage[] = greetingText
    ? [{ id: GREETING_ID, author: "agent", bubbles: [greetingText], at: "" }]
    : messages;
  const groups = groupMessages(shown);
  const reactions = reactionsByFounderMessage(messages);
  const readTimes = readTimesByFounderMessage(messages);
  const lastFounderId = [...messages].reverse().find((m) => m.author === "founder")?.id;
  const lastBubbles = messages[messages.length - 1]?.bubbles.join("").length ?? 0;
  // The latest agent message's own "Review the plan" reply already offers its hand-off: no second button for it.
  const latestAgent = [...messages].reverse().find((m) => m.author === "agent");
  const handOffInReplies = latestAgent?.quickReplies?.some((r) => r.kind === "hand_off")
    ? latestAgent.id
    : null;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.scrollTo !== "function") return;
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [messages.length, lastBubbles, replying, reduced]);

  const render = (text: string) => (renderBubble ? renderBubble(text) : text);
  const { state } = presenceWords(persona, replying);

  return (
    <div
      ref={ref}
      role="log"
      aria-label={`Messages: ${label}`}
      aria-live="polite"
      aria-relevant="additions"
      aria-busy={replying || undefined}
      tabIndex={0}
      className="desk-thread focus-ring"
      data-testid="desk-thread"
    >
      {groups.length === 0 && !replying ? (
        <p className="text-small text-tertiary">Pick a question below, or write your own.</p>
      ) : null}
      {groups.map((group, gi) => {
        const rows = rowsOf(group.messages);
        if (group.author === "agent") {
          return (
            <Fragment key={`g-${gi}-${group.messages[0]!.id}`}>
              {rows.map((row, ri) => {
                const isLast = ri === rows.length - 1;
                const fresh =
                  !initial.current!.has(row.message.id) && row.message.id !== GREETING_ID;
                const streaming = Boolean(row.message.streaming) && row.lastOfMessage;
                return (
                  <Fragment key={`${row.message.id}-${row.index}`}>
                    <div className="desk-row" data-author="agent">
                      {portraits ? (
                        <span className="desk-portrait-slot">
                          {isLast ? (
                            <Avatar
                              size={26}
                              name={persona.name}
                              agent={{ seed: persona.avatarSeed, dept: persona.dept }}
                              status={persona.status}
                              presence={state === "live" ? "live" : undefined}
                              surface={variant === "sheet" ? "surface-3" : "surface-1"}
                            />
                          ) : null}
                        </span>
                      ) : null}
                      <div
                        className={cn("desk-bubble", fresh && "desk-arrive")}
                        style={fresh ? ({ "--i": row.index } as CSSProperties) : undefined}
                        data-author="agent"
                        data-streaming={streaming || undefined}
                        data-greeting={row.message.id === GREETING_ID || undefined}
                        data-testid="agent-bubble"
                      >
                        <span className="sr-only">{persona.name}: </span>
                        {streaming ? (
                          <StreamingText
                            text={row.bubble}
                            open
                            render={renderBubble}
                            tone={persona.dept}
                          />
                        ) : (
                          render(row.bubble)
                        )}
                      </div>
                    </div>
                    {row.lastOfMessage && row.message.handOff ? (
                      <HandOffStrip
                        message={row.message}
                        onHandOff={
                          disabled || row.message.id === handOffInReplies ? undefined : onHandOff
                        }
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </Fragment>
          );
        }
        return (
          <Fragment key={`g-${gi}-${group.messages[0]!.id}`}>
            {rows.map((row) => {
              const reaction = row.lastOfMessage ? reactions.get(row.message.id) : undefined;
              const fresh = !initial.current!.has(row.message.id);
              const failed = row.message.state === "failed";
              const receipt = row.lastOfMessage && (row.message.id === lastFounderId || failed);
              return (
                <Fragment key={`${row.message.id}-${row.index}`}>
                  <div
                    className="desk-row"
                    data-author="founder"
                    data-reacted={reaction ? "" : undefined}
                  >
                    <div
                      className={cn("desk-bubble", fresh && "desk-arrive")}
                      data-author="founder"
                      data-testid="founder-bubble"
                    >
                      <span className="sr-only">You: </span>
                      {render(row.bubble)}
                      {reaction ? (
                        <Reaction reaction={reaction} by={persona.name} dept={persona.dept} />
                      ) : null}
                    </div>
                  </div>
                  {receipt ? (
                    <div className="flex items-center justify-end gap-2">
                      {failed && onRetry ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={RotateCcw}
                          onClick={() => onRetry(row.message.id)}
                        >
                          Try again
                        </Button>
                      ) : null}
                      <ReadReceipt
                        state={row.message.state ?? "seen"}
                        readAt={readTimes.get(row.message.id) ?? null}
                        datePrefs={datePrefs}
                      />
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </Fragment>
        );
      })}
      {replying ? (
        <TypingLine
          name={persona.name}
          phrase={thinkingPhraseFor(persona, thinkingPhrase)}
          dept={persona.dept}
          indent={portraits}
        />
      ) : null}
    </div>
  );
}

/** What the agent would hand off, and that nothing runs until the founder confirms the plan. */
function HandOffStrip({
  message,
  onHandOff,
}: {
  message: DeskMessage;
  onHandOff?: (messageId: string) => void;
}) {
  const h = message.handOff!;
  const staged = Boolean(message.planId);
  return (
    <div className="desk-handoff" data-testid="desk-handoff" data-gated={h.gated || undefined}>
      <Icon icon={h.gated ? Lock : ListChecks} size="inline" className="mt-px text-tertiary" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium text-primary">
          {h.gated ? "Yours to do: it needs you, not an agent" : "Ready to hand off"}
        </span>
        <span className="text-pretty">{h.instruction}</span>
        <span className="text-tertiary">
          {staged
            ? "Plan staged. Nothing runs until you confirm it."
            : "Nothing runs until you confirm the plan."}
        </span>
      </div>
      {onHandOff && !staged ? (
        <Button
          size="sm"
          variant="default"
          className="flex-none"
          onClick={() => onHandOff(message.id)}
        >
          Review the plan
        </Button>
      ) : null}
    </div>
  );
}
