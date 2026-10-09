"use client";
import { useState, type FormEvent } from "react";
import { Bookmark, BookmarkPlus, ChevronDown, Pencil, RotateCcw, Save, Trash2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { FitText } from "../foundation/FitText";
import { triggerChevronClass } from "../foundation/menuStyles";
import { Button } from "../foundation/Button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../foundation/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../foundation/DropdownMenu";
import { Icon } from "../foundation/Icon";
import { Input } from "../foundation/Input";
import { Label } from "../foundation/Label";
import type { SavedView } from "./types";

export interface SavedViewSelectorProps {
  views: readonly SavedView[];
  activeId: string | null;
  onSelect: (id: string) => void;
  /** Current table state differs from the saved view. */
  dirty?: boolean;
  /** Overwrite the active view with the current state. Omitted → no "Save view" item. */
  onSave?: () => void;
  /** Create a new view from the current state. */
  onSaveAs?: (name: string) => void;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string) => void;
  /** Discard unsaved changes and go back to the saved state. */
  onRevert?: () => void;
  className?: string;
}

type Prompt = { kind: "save-as" } | { kind: "rename"; id: string; name: string } | null;

/** The saved-view switcher at the top left of a DataTable (DESIGN §8). */
export function SavedViewSelector({
  views,
  activeId,
  onSelect,
  dirty,
  onSave,
  onSaveAs,
  onRename,
  onDelete,
  onRevert,
  className,
}: SavedViewSelectorProps) {
  const active = views.find((v) => v.id === activeId) ?? null;
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [name, setName] = useState("");
  const openPrompt = (p: Prompt) => {
    setName(p?.kind === "rename" ? p.name : active ? `${active.name} copy` : "New view");
    setPrompt(p);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || !prompt) return;
    if (prompt.kind === "save-as") onSaveAs?.(n);
    else onRename?.(prompt.id, n);
    setPrompt(null);
  };
  const canSave = !!onSave && !!active && !active.builtIn;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className={cn("group/trigger max-w-72 gap-1.5", className)}
            aria-label={`View: ${active?.name ?? "All"}${dirty ? " (unsaved changes)" : ""}`}
            data-saved-view={activeId ?? undefined}
          >
            <Icon icon={Bookmark} size="inline" className="text-secondary" />
            {/* Founders name their views: the name fits (steps down, then truncates with a tooltip). */}
            <span className="min-w-0 font-body text-body font-medium text-primary">
              <FitText minPx={11}>{active?.name ?? "All"}</FitText>
            </span>
            {dirty ? (
              <span className="shrink-0 rounded-pill bg-status-warn/12 px-1.5 text-small font-medium text-status-warn" aria-hidden>
                Edited
              </span>
            ) : null}
            <Icon icon={ChevronDown} size={12} className={cn("shrink-0 text-tertiary", triggerChevronClass)} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={activeId ?? ""} onValueChange={onSelect}>
            {views.map((v) => (
              <DropdownMenuRadioItem key={v.id} value={v.id}>
                <span className="truncate">{v.name}</span>
                {v.builtIn ? (
                  <span className="ml-auto pl-3 text-small text-secondary">Built in</span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          {canSave ? (
            <DropdownMenuItem onSelect={onSave} disabled={!dirty}>
              <Icon icon={Save} size="inline" className="text-secondary" />
              Save view
            </DropdownMenuItem>
          ) : null}
          {onSaveAs ? (
            <DropdownMenuItem onSelect={() => openPrompt({ kind: "save-as" })}>
              <Icon icon={BookmarkPlus} size="inline" className="text-secondary" />
              Save as new view…
            </DropdownMenuItem>
          ) : null}
          {onRename && active && !active.builtIn ? (
            <DropdownMenuItem
              onSelect={() => openPrompt({ kind: "rename", id: active.id, name: active.name })}
            >
              <Icon icon={Pencil} size="inline" className="text-secondary" />
              Rename…
            </DropdownMenuItem>
          ) : null}
          {onRevert ? (
            <DropdownMenuItem onSelect={onRevert} disabled={!dirty}>
              <Icon icon={RotateCcw} size="inline" className="text-secondary" />
              Discard changes
            </DropdownMenuItem>
          ) : null}
          {onDelete && active && !active.builtIn ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" onSelect={() => onDelete(active.id)}>
                <Icon icon={Trash2} size="inline" />
                Delete view
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={prompt !== null} onOpenChange={(o) => (o ? null : setPrompt(null))}>
        <DialogContent size="sm">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>
                {prompt?.kind === "rename" ? "Rename view" : "Save as new view"}
              </DialogTitle>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-1.5">
              <Label htmlFor="saved-view-name">Name</Label>
              <Input
                id="saved-view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                maxLength={60}
              />
            </DialogBody>
            <DialogFooter>
              <Button size="sm" variant="ghost" onClick={() => setPrompt(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
                {prompt?.kind === "rename" ? "Rename" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
