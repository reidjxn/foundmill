"use client";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ArrowUp, Check, ListChecks, Pencil } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Icon, type IconComponent } from "../foundation/Icon";
import { Input } from "../foundation/Input";
import { Kbd } from "../foundation/Kbd";
import { useGuided } from "../guidance/GuidanceProvider";
import { FALLBACK_QUICK_REPLIES, settleQuickReplies, type QuickReplyItem } from "./types";

export type QuickReplyKeyModifier = "none" | "alt";

/** The key that sends reply `n` (1–4) from a keyboard event, or null. Alt mode reads `code`, since Alt+1 types "¡". */
export function quickReplyIndexFromKey(
  e: Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
  modifier: QuickReplyKeyModifier,
): number | null {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (modifier === "alt" ? !e.altKey : e.altKey) return null;
  const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code ?? "");
  if (m) return Number(m[1]) - 1;
  if (modifier === "none" && /^[1-4]$/.test(e.key)) return Number(e.key) - 1;
  return null;
}

/**
 * True when an open dialog sits above `el` (a sheet over the page, a confirmation over a sheet): its number keys belong to
 * that dialog, never to replies underneath it.
 */
export function coveredByDialog(el: Element | null): boolean {
  if (typeof document === "undefined" || !el) return false;
  const open = document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]');
  const top = open[open.length - 1];
  return Boolean(top && !top.contains(el));
}

/** True when the keystroke belongs to a field (typing a digit into a text box never sends a reply). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).closest !== "function") return false;
  const el = target as HTMLElement;
  return Boolean(
    el.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox']",
    ),
  );
}

const KIND_ICON: Partial<Record<NonNullable<QuickReplyItem["kind"]>, IconComponent>> = {
  choose_option: Check,
  hand_off: ListChecks,
};

export interface QuickRepliesProps {
  /** The replies on offer (2–4 from the server). Fewer than two are padded from `fallbacks`; more than four are cut. */
  replies: readonly QuickReplyItem[];
  /** A reply was chosen (by press or by its number key). Fallback replies come through `onSend` as text instead. */
  onChoose: (reply: QuickReplyItem) => void;
  /** Send typed text (the Write field; fallback replies). Without it there is no Write button. */
  onSend?: (text: string) => void | Promise<unknown>;
  /** The agent's name, for the field's label and placeholder ("Reply to Juno"). */
  agentName?: string;
  /** Number keys send replies (1–4, or Alt+1–4 with `keyModifier="alt"`). Default true. */
  hotkeys?: boolean;
  /** "alt" where 1–4 already belong to something else (the Inbox's DecisionBar). */
  keyModifier?: QuickReplyKeyModifier;
  disabled?: boolean;
  /** The reply being sent: pressed look, the others wait. */
  pendingId?: string | null;
  /** The ghost button's label. Default "Write" (a server `write` reply such as "Something else…" folds into it). */
  writeLabel?: string;
  /** Replies used to reach two when fewer arrive. */
  fallbacks?: readonly QuickReplyItem[];
  /** Open the Write field from the start. */
  defaultWriting?: boolean;
  /** The group's accessible name. Default "Quick replies". */
  label?: string;
  className?: string;
}

/**
 * Quick replies (DIRECTION #6, SPEC "Quick replies"): always 2–4 when the founder is expected to respond, numbered 1–4
 * with a key cap, the likeliest brand-tinted, rising in 40 ms apart; labels wrap to two lines and are never cut, and a
 * reply's `description` is a small second line under the label ("This answers the note"). A ghost Write reveals a
 * one-line field (Enter sends, Escape closes): typing is optional, never required.
 */
export function QuickReplies({
  replies,
  onChoose,
  onSend,
  agentName,
  hotkeys = true,
  keyModifier = "none",
  disabled = false,
  pendingId = null,
  writeLabel,
  fallbacks = FALLBACK_QUICK_REPLIES,
  defaultWriting = false,
  label = "Quick replies",
  className,
}: QuickRepliesProps) {
  const { choices, likeliest } = useMemo(
    () => settleQuickReplies(replies, fallbacks),
    [replies, fallbacks],
  );
  const [writing, setWriting] = useState(defaultWriting);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const writeButtonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldId = useId();
  const [mac, setMac] = useState(false);
  useEffect(() => {
    if (typeof navigator !== "undefined")
      setMac(/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent));
  }, []);

  const busy = disabled || sending || pendingId !== null;
  const canWrite = Boolean(onSend);

  const choose = (reply: QuickReplyItem) => {
    if (busy) return;
    if (reply.kind === "write") {
      setWriting(true);
      return;
    }
    if (reply.fallback) void onSend?.(reply.say ?? reply.label);
    else onChoose(reply);
  };

  // Number keys anywhere on the page, except while typing in a field or while a dialog covers these replies.
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    if (!hotkeys || disabled || choices.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || isTypingTarget(e.target) || coveredByDialog(rootRef.current)) return;
      const i = quickReplyIndexFromKey(e, keyModifier);
      if (i === null) return;
      const reply = choices[i];
      if (!reply) return;
      e.preventDefault();
      chooseRef.current(reply);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [hotkeys, disabled, choices, keyModifier]);

  useEffect(() => {
    if (writing) fieldRef.current?.focus();
  }, [writing]);

  const closeField = () => {
    setWriting(false);
    requestAnimationFrame(() => writeButtonRef.current?.focus());
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !onSend || sending || disabled) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft("");
      setWriting(false);
    } catch {
      // Keep the words: the caller shows why it failed.
    } finally {
      setSending(false);
    }
  };

  const onFieldKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeField();
    } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  // The 1–4 (or ⌥1–4) key caps are an operator's affordance: they render only while guidance is off (UX plan §7.7,
  // the DecisionBar's rule). The keys work either way, and aria-keyshortcuts names them in both states.
  const showKeys = !useGuided();
  const keyLabel = (n: number) =>
    keyModifier === "alt" ? (mac ? `⌥${n}` : `Alt+${n}`) : String(n);
  const writeWord = writeLabel ?? "Write";
  const who = agentName ? `Reply to ${agentName}` : "Write a reply";

  return (
    <div ref={rootRef} className={cn("flex min-w-0 flex-col gap-2.5", className)} data-testid="quick-replies">
      <div role="group" aria-label={label} className="quick-replies">
        {choices.map((reply, i) => {
          const likely = reply.id === likeliest;
          const kindIcon = reply.kind ? KIND_ICON[reply.kind] : undefined;
          return (
            <Button
              key={reply.id}
              variant={likely ? "tinted" : "default"}
              // At 390 px a finger presses it: 44 px tall at least (CLAUDE.md "Small screens"), like the DecisionBar's Ask.
              className="quick-reply h-auto min-h-control-md gap-2 whitespace-normal py-1 pl-1.5 text-left in-data-[phone]:min-h-tap"
              style={{ "--i": i } as CSSProperties}
              disabled={disabled || (busy && pendingId !== reply.id)}
              aria-keyshortcuts={keyModifier === "alt" ? `Alt+${i + 1}` : String(i + 1)}
              data-chosen={pendingId === reply.id || undefined}
              data-likeliest={likely || undefined}
              data-quick-reply={reply.id}
              onClick={() => choose(reply)}
            >
              {showKeys ? (
                <Kbd size="md" aria-hidden className={cn(likely && "text-primary")}>
                  {keyLabel(i + 1)}
                </Kbd>
              ) : null}
              {kindIcon ? (
                <Icon
                  icon={kindIcon}
                  size="inline"
                  className={likely ? "text-kit-lift" : "text-tertiary"}
                />
              ) : null}
              <span className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="min-w-0 text-balance">{reply.label}</span>
                {reply.description ? (
                  // The second line (Button's `btn-desc`, small text) sits under the label, not under the key cap.
                  <span className="btn-desc text-pretty" data-quick-reply-description="">
                    {reply.description}
                  </span>
                ) : null}
              </span>
            </Button>
          );
        })}
        {canWrite && !writing ? (
          <Button
            ref={writeButtonRef}
            variant="ghost"
            size="md"
            icon={Pencil}
            className="quick-reply ml-auto in-data-[phone]:min-h-tap"
            style={{ "--i": choices.length } as CSSProperties}
            disabled={disabled}
            data-quick-reply="write"
            onClick={() => setWriting(true)}
          >
            {writeWord}
          </Button>
        ) : null}
      </div>
      {canWrite && writing ? (
        <form
          id={fieldId}
          className="desk-write"
          data-testid="quick-reply-write"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            ref={fieldRef}
            aria-label={who}
            placeholder={`${who}…`}
            value={draft}
            maxLength={2000}
            disabled={disabled || sending}
            wrapperClassName="min-w-0 flex-1"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onFieldKey}
            trailing={<Kbd aria-hidden>Esc</Kbd>}
          />
          <Button
            type="submit"
            variant="primary"
            icon={ArrowUp}
            className="in-data-[phone]:min-h-tap"
            loading={sending}
            disabled={!draft.trim() || disabled}
          >
            Send
          </Button>
        </form>
      ) : null}
    </div>
  );
}
