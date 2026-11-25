"use client";
/**
 * LaunchChecklist (founder, Nov 25, 2026): the short "Before it goes live" list inside the dialog where the founder
 * approves the public page going live for the first time. Each row is a check (Ready) or a neutral circle (Not yet),
 * the item's label, one plain sentence and, for a Not yet item that has one, a single ghost action. It never blocks:
 * it renders no control over the dialog's own approve button, and the closing line says publishing works either way.
 */
import { useId } from "react";
import { Circle, CircleCheck } from "lucide-react";
import { LAUNCH_CHECKLIST_WORDS, type LaunchCheck } from "@foundmill/shared/launch-checklist";
import { Button } from "../foundation/Button";
import { Icon } from "../foundation/Icon";

export interface LaunchChecklistProps {
  items: readonly LaunchCheck[];
  /** Runs a Not yet item's action (for example turning on the Follow form). Without it, no action shows. */
  onAction?: (actionId: NonNullable<LaunchCheck["action"]>["id"]) => void;
}

export function LaunchChecklist({ items, onAction }: LaunchChecklistProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2" data-testid="launch-checklist">
      <h3 id={headingId} className="t-label text-secondary">
        {LAUNCH_CHECKLIST_WORDS.title}
      </h3>
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2 border-b border-line-faint py-2 last:border-b-0" data-launch-check={item.id} data-ready={item.ready || undefined}>
            {item.ready ? <Icon icon={CircleCheck} className="mt-0.5 text-status-good" label={LAUNCH_CHECKLIST_WORDS.ready} /> : <Icon icon={Circle} className="mt-0.5 text-tertiary" label={LAUNCH_CHECKLIST_WORDS.notYet} />}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="t-body text-primary">
                {item.label} <span className="text-tertiary">· {item.ready ? LAUNCH_CHECKLIST_WORDS.ready : LAUNCH_CHECKLIST_WORDS.notYet}</span>
              </p>
              <p className="t-body text-secondary text-pretty">{item.line}</p>
              {!item.ready && item.action && onAction ? (
                <div>
                  <Button variant="ghost" size="sm" onClick={() => onAction(item.action!.id)}>
                    {item.action.label}
                  </Button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="t-body text-tertiary">{LAUNCH_CHECKLIST_WORDS.note}</p>
    </section>
  );
}
