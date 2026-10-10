"use client";
import { useId, useState } from "react";
import { Megaphone, MessageSquareText } from "lucide-react";
import { Button } from "../foundation/Button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../foundation/DropdownMenu";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";
import { Field } from "../foundation/Label";
import { Textarea } from "../foundation/Textarea";

/** The longest nudge the API accepts (`dev.tasks.shout`: text ≤ 280). */
export const NUDGE_MAX_LENGTH = 280;

/** A nudge that fits who is being nudged (the persona's `nudges` from `agent.conversation.get`). */
export interface NudgeMenuPreset {
  key: string;
  /** Sentence case, the menu row. */
  label: string;
  /** One line under the label. */
  hint?: string;
  /** What reaches the session (≤ 280). Defaults to the label. */
  text?: string;
}

/** What was sent: a preset (its key) or the founder's own words (`key` null). */
export interface Nudge {
  key: string | null;
  text: string;
}

export interface NudgeMenuProps {
  /** Who hears it: "Backend Engineer", "all agents". */
  target: string;
  /** The presets for this agent; the custom message is always there. */
  presets: readonly NudgeMenuPreset[];
  onNudge: (nudge: Nudge) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** A labelled "Nudge <target>" button instead of an icon button. */
  labelled?: boolean;
  /** Default 280, the API's limit. */
  maxLength?: number;
}

/**
 * Nudge an agent (BUILD §11.6, audit-conversation §4 "Nudge"): the presets that fit that agent — "Focus on tests" for
 * an engineer, other words for a channel agent or a specialist — and a custom message of at most 280 characters (the
 * API's limit). A nudge is advice into a running session, never an instruction to act on a hard gate.
 */
export function NudgeMenu({ target, presets, onNudge, disabled, size = "sm", labelled, maxLength = NUDGE_MAX_LENGTH }: NudgeMenuProps) {
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  const id = useId();
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onNudge({ key: null, text: t.slice(0, maxLength) });
    setText("");
    setCustom(false);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {labelled ? (
            <Button size={size} icon={Megaphone} disabled={disabled} data-testid="nudge-menu">
              Nudge {target}
            </Button>
          ) : (
            <IconButton icon={Megaphone} label={`Nudge ${target}`} size={size} disabled={disabled} data-testid="nudge-menu" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel>Nudge {target}</DropdownMenuLabel>
          {presets.map((p) => (
            <DropdownMenuItem key={p.key} onSelect={() => onNudge({ key: p.key, text: (p.text ?? p.label).slice(0, maxLength) })} className="h-auto min-h-control-md flex-col items-start gap-0.5 py-2" data-nudge-preset={p.key}>
              <span className="text-body font-medium leading-4 text-primary">{p.label}</span>
              {p.hint ? <span className="text-small text-tertiary group-data-highlighted/item:text-secondary">{p.hint}</span> : null}
            </DropdownMenuItem>
          ))}
          {presets.length ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => setCustom(true)} data-nudge-preset="custom">
            <Icon icon={MessageSquareText} size="inline" className="text-secondary" />
            Custom message…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={custom} onOpenChange={setCustom}>
        <DialogContent size="sm" aria-describedby={`${id}-desc`}>
          <DialogHeader>
            <DialogTitle>Nudge {target}</DialogTitle>
            <DialogDescription id={`${id}-desc`}>One short instruction. It reaches the session within two seconds and appears in its log.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field htmlFor={`${id}-text`} label="Message" hint={`${text.length} / ${maxLength}`}>
              <Textarea
                id={`${id}-text`}
                value={text}
                maxLength={maxLength}
                rows={3}
                autoFocus
                placeholder="Use the existing date helper instead of a new dependency."
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
                }}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCustom(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon={Megaphone} disabled={!text.trim()} onClick={send}>
              Send nudge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
