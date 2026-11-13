"use client";
/**
 * FormerProjectCard (security review P2-3; docs/DESIGN.md §9g): the small card on the home of a founder someone else
 * demoted or removed in the last 7 days, while a deletion of that project waits. It says when the project is deleted and
 * until when they can still stop it, and that stopping it gives them nothing else back. Cancel asks once more in place
 * ("Yes, cancel the deletion" / "Not now") before the host sends it, so one stray tap never decides. Calm: a plain
 * surface, no color, no badge, no count. The words are @foundmill/shared `FORMER_PROJECT_CARD`; the host formats the
 * dates (the person's own format) and sends the cancel.
 */
import { CalendarX2, Check } from "lucide-react";
import { useState } from "react";
import { FORMER_PROJECT_CARD } from "@foundmill/shared";
import { cn } from "../../lib/cn";
import { Button } from "../foundation/Button";
import { Icon } from "../foundation/Icon";
import { spanClass } from "../shell/PageGrid";
import type { GridSpan } from "../shell/types";

export interface FormerProjectCardProps {
  projectName: string;
  /** The day the deletion happens, as the person reads dates ("Nov 20, 2026"). */
  scheduledFor: string;
  /** The last moment they can cancel ("Nov 20, 2026 at 3:45 PM"). */
  until: string;
  /** Sends the cancel; called only after the second, confirming press. */
  onCancel: () => void;
  /** The cancel is on its way. */
  pending?: boolean;
  /** The cancel went through: the card says so in place of the buttons. */
  done?: boolean;
  /** A refusal, in plain words, shown under the buttons. */
  error?: string | null;
  span?: GridSpan;
  className?: string;
}

export function FormerProjectCard({ projectName, scheduledFor, until, onCancel, pending = false, done = false, error = null, span = 12, className }: FormerProjectCardProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className={cn("min-w-0", spanClass(span), className)} data-testid="former-project-card" data-state={done ? "done" : confirming ? "confirming" : "ready"} aria-label={FORMER_PROJECT_CARD.title(projectName)}>
      <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-1 p-panel-pad">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon icon={done ? Check : CalendarX2} className="mt-0.5 shrink-0 text-tertiary" />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="t-body-strong text-primary">{done ? FORMER_PROJECT_CARD.done(projectName) : FORMER_PROJECT_CARD.title(projectName)}</h2>
            {done ? null : (
              <>
                <p className="t-body text-secondary">{FORMER_PROJECT_CARD.body({ scheduledFor, until })}</p>
                <p className="t-small text-tertiary">{FORMER_PROJECT_CARD.note}</p>
              </>
            )}
          </div>
        </div>
        {done ? null : (
          <div className="flex flex-wrap gap-2">
            {confirming ? (
              <>
                <Button size="sm" variant="primary" loading={pending} onClick={onCancel} data-testid="former-project-confirm">
                  {FORMER_PROJECT_CARD.confirm}
                </Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
                  {FORMER_PROJECT_CARD.keep}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirming(true)} data-testid="former-project-cancel">
                {FORMER_PROJECT_CARD.button}
              </Button>
            )}
          </div>
        )}
        {error ? (
          <p className="t-small text-secondary" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
