import { useMemo } from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Kbd } from "../foundation/Kbd";
import { shortcutList, type DepartmentForKeys, type KeyboardShortcut, type ShortcutGroup } from "./keyboard";

export interface KeyboardHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Departments in the founder's order, so their G chords are listed. */
  departments?: readonly DepartmentForKeys[];
}

const GROUP_ORDER: readonly ShortcutGroup[] = ["Navigation", "Inbox", "Decisions", "Layout", "Help"];

/** Shortcuts grouped in display order. Exported for tests. */
export function groupShortcuts(list: readonly KeyboardShortcut[]): Array<{ group: ShortcutGroup; items: KeyboardShortcut[] }> {
  return GROUP_ORDER.map((group) => ({ group, items: list.filter((s) => s.group === group) })).filter((g) => g.items.length > 0);
}

/** The keyboard map overlay (BUILD §5.5): every shortcut with its keys, department chords included. Opens on "?". */
export function KeyboardHelp({ open, onOpenChange, departments = [] }: KeyboardHelpProps) {
  const groups = useMemo(() => groupShortcuts(shortcutList(departments)), [departments]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="keyboard-help">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Single keys work anywhere outside a text field. Chords are two keys in a row.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {groups.map((g) => (
            <section key={g.group} aria-labelledby={`kh-${g.group}`}>
              <h3 id={`kh-${g.group}`} className="t-label mb-1">
                {g.group}
              </h3>
              <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1">
                {g.items.map((s) => (
                  <div key={s.id} className="contents">
                    <dt className="inline-flex items-center gap-1">
                      {s.keys.map((k, i) => (
                        <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
                          {i > 0 && s.id !== "option" ? (
                            <span aria-hidden className="text-small text-secondary">
                              then
                            </span>
                          ) : null}
                          {k === "–" ? (
                            <span aria-hidden className="text-small text-secondary">
                              to
                            </span>
                          ) : (
                            <Kbd>{k}</Kbd>
                          )}
                        </span>
                      ))}
                    </dt>
                    <dd className="text-body text-secondary">{s.label}</dd>
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
