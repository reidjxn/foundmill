"use client";
import { useEffect, useRef, useState, type FormEvent, type HTMLAttributes, type KeyboardEvent } from "react";
import { Captions, Mic, MicOff, PanelRight, PhoneOff, SendHorizontal } from "lucide-react";
import { TEAM_CALL_LIMITS, TEAM_CALL_WORDS, type TeamCallKind } from "@foundmill/shared/team-call";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { IconButton } from "../foundation/IconButton";
import { Input } from "../foundation/Input";
import { Label } from "../foundation/Label";
import { Switch } from "../foundation/Switch";
import { CallLevelBars } from "./CallTile";

export interface CallControlsProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  kind: TeamCallKind;
  micOn: boolean;
  /** 0..1, the live mic level beside the mic button. */
  micLevel?: number;
  /** The browser gave no microphone: the mic button is off for good and the field says to type. */
  micUnavailable?: boolean;
  onToggleMic: () => void;
  /** "Type instead": the founder's typed turn. */
  onSubmitText: (text: string) => void;
  /** Team calls only: "Let the team discuss". */
  discussOn?: boolean;
  onDiscussChange?: (on: boolean) => void;
  captionsOn: boolean;
  onToggleCaptions: () => void;
  transcriptOn: boolean;
  onToggleTranscript: () => void;
  /** Ends the call. Esc never calls it: ending files the call's actions, so it takes a deliberate press. */
  onEnd: () => void;
  /** The wrap-up is being written: End is busy and everything else waits. */
  ending?: boolean;
  /** The viewer cannot speak (Team read only): everything but captions and transcript is disabled. */
  disabled?: boolean;
  /** M toggles the mic from anywhere on the page except while typing. Default true. */
  hotkeys?: boolean;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/**
 * The bottom bar: mic toggle with its level (M), the "Type instead" field with a send button, "Let the team discuss"
 * (team calls only), captions, transcript and End (danger; "End call and file actions" on a team call, "End call" on a
 * one-to-one). Controlled: every press calls back with an intent. Esc clears and leaves the typing field and does
 * nothing else; it never ends the call.
 */
export function CallControls({
  kind,
  micOn,
  micLevel = 0,
  micUnavailable = false,
  onToggleMic,
  onSubmitText,
  discussOn = false,
  onDiscussChange,
  captionsOn,
  onToggleCaptions,
  transcriptOn,
  onToggleTranscript,
  onEnd,
  ending = false,
  disabled = false,
  hotkeys = true,
  className,
  ...rest
}: CallControlsProps) {
  const [text, setText] = useState("");
  const micRef = useRef(onToggleMic);
  micRef.current = onToggleMic;
  const blocked = disabled || ending;
  const micBlocked = blocked || micUnavailable;

  useEffect(() => {
    if (!hotkeys || micBlocked) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== "m" || e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented || isTyping(e.target)) return;
      e.preventDefault();
      micRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, micBlocked]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || blocked) return;
    onSubmitText(t);
    setText("");
  };
  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // Leaves the field; never ends the call.
      e.stopPropagation();
      setText("");
      e.currentTarget.blur();
    }
  };

  return (
    <div role="toolbar" aria-label="Call controls" className={cn("call-controls", className)} data-testid="call-controls" {...rest}>
      <div className="flex items-center gap-2">
        <Button
          icon={micOn ? Mic : MicOff}
          active={micOn && !micUnavailable}
          tone="good"
          aria-pressed={micOn && !micUnavailable}
          aria-keyshortcuts="M"
          disabled={micBlocked}
          kbd="M"
          onClick={onToggleMic}
          data-testid="call-mic"
        >
          {micUnavailable ? TEAM_CALL_WORDS.muted : micOn ? "Mic on" : TEAM_CALL_WORDS.muted}
        </Button>
        {micOn && !micUnavailable ? <CallLevelBars level={micLevel} /> : null}
      </div>

      <form className="flex min-w-60 flex-1 items-center gap-1.5" onSubmit={submit}>
        <Input
          controlSize="md"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onFieldKey}
          placeholder={micUnavailable ? TEAM_CALL_WORDS.noMic : TEAM_CALL_WORDS.typeInstead}
          aria-label={TEAM_CALL_WORDS.typeInstead}
          maxLength={TEAM_CALL_LIMITS.maxFounderChars}
          disabled={blocked}
          autoComplete="off"
          data-testid="call-type"
        />
        <IconButton icon={SendHorizontal} label="Send" type="submit" variant="default" disabled={blocked || text.trim() === ""} data-testid="call-send" />
      </form>

      {kind === "team" ? (
        <div className="flex items-center gap-2">
          <Switch id="call-discuss" size="md" checked={discussOn} onCheckedChange={(on) => onDiscussChange?.(on)} disabled={blocked} data-testid="call-discuss" />
          <Label htmlFor="call-discuss" className="cursor-pointer text-body text-primary">
            {TEAM_CALL_WORDS.discuss}
          </Label>
        </div>
      ) : null}

      <div className="flex items-center gap-1">
        <Button variant="ghost" icon={Captions} active={captionsOn} aria-pressed={captionsOn} onClick={onToggleCaptions} data-testid="call-captions-toggle">
          Captions
        </Button>
        <Button variant="ghost" icon={PanelRight} active={transcriptOn} aria-pressed={transcriptOn} onClick={onToggleTranscript} data-testid="call-transcript-toggle">
          Transcript
        </Button>
      </div>

      <Button variant="danger" icon={PhoneOff} loading={ending} disabled={disabled || ending} onClick={onEnd} className="ml-auto" data-testid="call-end">
        {ending ? TEAM_CALL_WORDS.wrappingUp : kind === "team" ? TEAM_CALL_WORDS.endTeamCall : TEAM_CALL_WORDS.endCall}
      </Button>
    </div>
  );
}
