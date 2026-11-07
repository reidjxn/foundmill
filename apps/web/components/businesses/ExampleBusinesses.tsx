"use client";
/**
 * Your businesses › Example (docs/UX_AUDIT_AND_PLAN.md §12 item 5; 0065): the example business the founder opened from
 * New business, listed under its own heading and never counted among their own. One row: its logo, name, the neutral
 * "Example" chip with the viewer's role, one line that says nothing done there is saved, Leave (a confirm dialog whose
 * ConsequenceLine says nothing is deleted and the example reopens from New business) and Open. Presentational: the
 * screen wires `business.example.leave`. Renders nothing without an example row.
 */
import { ArrowRight, LogOut } from "lucide-react";
import { useState } from "react";
import { Button, BusinessLogo, Chip, ConsequenceLine, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Panel } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { EXAMPLE_CHIP_TOOLTIP } from "@/lib/access";
import { rememberLastBusiness } from "@/lib/auth/last-business";
import { ROLE_WORD } from "@/lib/roles";
import type { FounderBusiness } from "@/components/shell/business-switcher";
import { LinkButton } from "@/components/new/LinkButton";

/** The row's line: the same words as the Example frame's chip (lib/access.ts). */
export { EXAMPLE_CHIP_TOOLTIP };
/** The consequence under Leave (always shown: a consequence is information). */
export const LEAVE_EXAMPLE_CONSEQUENCE = "Nothing is deleted; you can open it again from New business.";

export interface ExampleBusinessesProps {
  /** The founder's example rows (`founder.businesses.list` rows with `isExample`). */
  rows: readonly FounderBusiness[];
  /** Business id → logo data URL (null: the initials mark). */
  logos: Readonly<Record<string, string | null>>;
  /** The business being left (its Leave shows loading and the dialog stays until it answers). */
  leaving?: string | null;
  onLeave: (businessId: string) => void;
}

/** The founder's own rows and their example rows, from one `founder.businesses.list`. */
export function splitExampleRows<T extends { isExample: boolean }>(rows: readonly T[]): { own: T[]; examples: T[] } {
  return { own: rows.filter((r) => !r.isExample), examples: rows.filter((r) => r.isExample) };
}

export function ExampleBusinesses({ rows, logos, leaving, onLeave }: ExampleBusinessesProps) {
  const [confirm, setConfirm] = useState<string | null>(null);
  if (rows.length === 0) return null;
  const confirming = confirm ? rows.find((r) => r.id === confirm) ?? null : null;
  return (
    <div className="mt-gutter">
      <Panel title="Example" data-testid="example-businesses">
        <ul className="flex flex-col divide-y divide-line-faint">
          {rows.map((b) => (
            <li key={b.id} data-business-row={b.id} data-example-row="" className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <BusinessLogo src={logos[b.id] ?? null} name={b.name} primary={b.kitPrimary} size={32} title="" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="t-display-sm min-w-0 break-words">{b.name}</span>
                  <Chip data-testid="example-row-chip">Example</Chip>
                  <Chip>{ROLE_WORD[b.role]}</Chip>
                </div>
                <p className="text-small text-secondary">{EXAMPLE_CHIP_TOOLTIP}</p>
              </div>
              <Button size="sm" variant="ghost" icon={LogOut} loading={leaving === b.id} onClick={() => setConfirm(b.id)} aria-label={`Leave ${b.name}`} data-testid="example-leave">
                Leave
              </Button>
              <LinkButton size="sm" variant="default" iconRight={ArrowRight} href={routes.today(b.id)} onClick={() => rememberLastBusiness(b.id)} aria-label={`Open ${b.name}`}>
                Open
              </LinkButton>
            </li>
          ))}
        </ul>
      </Panel>

      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent size="sm" data-testid="example-leave-dialog">
          <DialogHeader>
            <DialogTitle>Leave {confirming?.name ?? "the example"}?</DialogTitle>
            <DialogDescription>It leaves your businesses and the top bar's Switch business.</DialogDescription>
          </DialogHeader>
          <ConsequenceLine consequence={LEAVE_EXAMPLE_CONSEQUENCE} reversible className="px-5 pb-1" data-testid="example-leave-consequence" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={LogOut}
              loading={confirming !== null && leaving === confirming.id}
              onClick={() => {
                if (confirming) onLeave(confirming.id);
                setConfirm(null);
              }}
              data-testid="example-leave-confirm"
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
