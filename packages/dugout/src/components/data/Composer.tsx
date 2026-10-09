"use client";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Send } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import type { IconComponent } from "../foundation/Icon";
import { Keys } from "../foundation/Kbd";
import { Textarea } from "../foundation/Textarea";

export interface ComposerProps {
  /** Receives the trimmed text. The field clears when this resolves; when it rejects the text stays so nothing is lost. */
  onSubmit: (body: string) => void | Promise<unknown>;
  /** Accessible name of the field (there is no visible label). */
  "aria-label": string;
  /** The button. Default "Send". */
  label?: string;
  icon?: IconComponent;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  /** The caller's own request is in flight (the composer also tracks the promise `onSubmit` returns). */
  submitting?: boolean;
  /** Small-style note under the field, left of the shortcut hint. */
  note?: ReactNode;
  autoFocus?: boolean;
  className?: string;
}

/**
 * A message or post box: a 32 px-grid textarea, a button and a note. Ctrl+Enter or Cmd+Enter sends (plain Enter is a
 * new line); an empty or whitespace-only field cannot be sent; a second press while the first is in flight is ignored.
 * Used for human-to-human messages, community posts and replies: whoever is signed in presses Send, nothing sends for them.
 */
export function Composer({ onSubmit, label = "Send", icon = Send, placeholder, rows = 3, maxLength = 20_000, disabled, submitting, note, autoFocus, className, "aria-label": ariaLabel }: ComposerProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const body = value.trim();
  const working = busy || !!submitting;
  const canSend = body.length > 0 && !working && !disabled;

  const submit = async () => {
    if (!canSend) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setValue("");
    } catch {
      /* The caller reports the failure; the text stays in the field. */
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-composer>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        aria-describedby={note ? noteId : undefined}
        aria-busy={working || undefined}
      />
      <div className="flex items-center gap-3">
        <div id={noteId} className="min-w-0 flex-1 text-small text-secondary">
          {note}
        </div>
        <Keys keys={["Ctrl", "Enter"]} separator="+" className="shrink-0" />
        <Button size="sm" icon={icon} loading={working} disabled={!canSend && !working} onClick={() => void submit()}>
          {label}
        </Button>
      </div>
    </div>
  );
}
