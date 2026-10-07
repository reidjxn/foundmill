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
import type { Shout, ShoutPreset } from "./types";

/** BUILD §11.6 Shouts. "Hurry up" means prefer smaller changes. */
export const SHOUT_PRESETS: ReadonlyArray<{ key: ShoutPreset; label: string; hint: string }> = [
  { key: "focus_on_tests", label: "Focus on tests", hint: "Make the acceptance tests pass before anything else." },
  { key: "simplify", label: "Simplify", hint: "Remove abstraction; the smallest change that works." },
  { key: "ask_before_schema_changes", label: "Ask before schema changes", hint: "Stop and request a decision before touching migrations." },
  { key: "match_design_system", label: "Match the design system", hint: "Tokens and Dugout components only." },
  { key: "hurry_up", label: "Hurry up", hint: "Prefer smaller changes and ship sooner." },
];

export const SHOUT_MAX_LENGTH = 500;

export interface ShoutMenuProps {
  /** Who hears it: an agent name, or "all agents". */
  target: string;
  onShout: (shout: Shout) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Render as a labelled button instead of an icon button. */
  labelled?: boolean;
}

/** The Shout control: a menu with the five preset shouts and a custom-text dialog. */
export function ShoutMenu({ target, onShout, disabled, size = "sm", labelled }: ShoutMenuProps) {
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  const id = useId();
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onShout({ preset: null, text: t.slice(0, SHOUT_MAX_LENGTH) });
    setText("");
    setCustom(false);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {labelled ? (
            <Button size={size} icon={Megaphone} disabled={disabled}>
              Shout
            </Button>
          ) : (
            <IconButton icon={Megaphone} label={`Shout to ${target}`} size={size} disabled={disabled} />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-64">
          <DropdownMenuLabel>Shout to {target}</DropdownMenuLabel>
          {SHOUT_PRESETS.map((p) => (
            <DropdownMenuItem key={p.key} onSelect={() => onShout({ preset: p.key, text: p.label })} className="h-auto flex-col items-start gap-0 py-1.5">
              <span className="text-body text-primary">{p.label}</span>
              <span className="text-small text-secondary">{p.hint}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCustom(true)}>
            <Icon icon={MessageSquareText} size="inline" className="text-secondary" />
            Custom message…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={custom} onOpenChange={setCustom}>
        <DialogContent size="sm" aria-describedby={`${id}-desc`}>
          <DialogHeader>
            <DialogTitle>Shout to {target}</DialogTitle>
            <DialogDescription id={`${id}-desc`}>One short instruction. It reaches the session within two seconds and appears in its log.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field htmlFor={`${id}-text`} label="Message" hint={`${text.length} / ${SHOUT_MAX_LENGTH}`}>
              <Textarea
                id={`${id}-text`}
                value={text}
                maxLength={SHOUT_MAX_LENGTH}
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
              Send shout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
