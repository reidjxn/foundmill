import { useMemo } from "react";
import type { AreaKey } from "@foundmill/shared";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Kbd } from "../foundation/Kbd";
import { shortcutList, type DepartmentForKeys, type KeyboardShortcut, type ShortcutGroup } from "./keyboard";

export interface KeyboardHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Module-less departments in the founder's order, so their G chords are listed. */
  departments?: readonly DepartmentForKeys[];
  /** The founder areas the sidebar shows, so their G chords are listed (G P Plan, G C Customers, …). */
  areas?: readonly AreaKey[];
}

const EMPTY_DEPARTMENTS: readonly DepartmentForKeys[] = [];
const EMPTY_AREAS: readonly AreaKey[] = [];

const GROUP_ORDER: readonly ShortcutGroup[] =["Navigation", "Inbox", "Decisions", "Layout", "Help"];

/** Shortcuts grouped in display order. Exported for tests. */
export function groupShortcuts(list: readonly KeyboardShortcut[]): Array<{ group: ShortcutGroup; items: KeyboardShortcut[] }> {
  return GROUP_ORDER.map((group) => ({ group, items: list.filter((s) => s.group === group) })).filter((g) => g.items.length > 0);
}

/**
 * The keyboard map overlay (BUILD §5.5): every shortcut with its keys, area and department chords included, in groups under data
 * labels, in two columns; each row reads the action on the left and its key caps on the right. Opens on "?", from the
 * sidebar foot's "?" cap and from the palette's Help row "Keyboard shortcuts" (B15). Always lists every shortcut,
 * whatever the guidance setting.
 */
export function KeyboardHelp({ open, onOpenChange, departments = EMPTY_DEPARTMENTS, areas = EMPTY_AREAS }: KeyboardHelpProps) {
  const groups = useMemo(() => groupShortcuts(shortcutList(departments, areas)), [departments, areas]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="keyboard-help">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single keys work anywhere outside a text field. Chords are two keys in a row.</DialogDescription>
        </DialogHeader>
        <DialogBody className="columns-2 gap-x-6">
          {groups.map((g) => (
            <section key={g.group} aria-labelledby={`kh-${g.group}`} className="mb-4 flex break-inside-avoid flex-col gap-1">
              <h3 id={`kh-${g.group}`} className="t-data">
                {g.group}
              </h3>
              <dl className="flex flex-col">
                {g.items.map((s) => (
                  <div key={s.id} className="flex min-h-control-md flex-row-reverse items-center justify-between gap-4 border-b border-line-faint py-1 last:border-b-0">
                    <dt className="inline-flex shrink-0 items-center gap-1">
                      {s.keys.map((k, i) => (
                        <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
                          {i > 0 && s.id !== "option" ? (
                            <span aria-hidden className="text-small text-tertiary">
                              then
                            </span>
                          ) : null}
                          {k === "–" ? (
                            <span aria-hidden className="text-small text-tertiary">
                              to
                            </span>
                          ) : (
                            <Kbd>{k}</Kbd>
                          )}
                        </span>
                      ))}
                    </dt>
                    <dd className="min-w-0 text-body text-secondary">{s.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
