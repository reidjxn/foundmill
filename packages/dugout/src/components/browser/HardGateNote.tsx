/**
 * The hard-gate note's page (founder, Nov 22, 2026): when the team stopped before pressing something only the founder
 * presses in a website (pay, buy, agree, sign, delete, security), this is the page exactly as it was before that press,
 * its address, and the amount the page showed. Nothing here presses anything: "Open <site>" goes to Working now, where
 * the founder's own press happens in the live view.
 */
import { ExternalLink } from "lucide-react";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";

export interface HardGateNoteProps {
  siteName: string;
  /** What the team was about to press, in the page's words ("Buy now"). */
  label: string;
  /** The page's address. */
  address: string;
  /** The amount the page showed ("$29.00"), when there was one. */
  amount: string | null;
  /** The page before the press, as an image address; null when none was kept. */
  screenshotDataUrl: string | null;
  loading?: boolean;
  simulated?: boolean;
  /** Goes to the session on Working now. */
  onOpenSite: () => void;
}

export function HardGateNote({ siteName, label, address, amount, screenshotDataUrl, loading = false, simulated = false, onOpenSite }: HardGateNoteProps) {
  return (
    <section className="flex flex-col gap-2 rounded-sm border border-line-faint px-3 py-2" aria-label={`The page in ${siteName}`} data-testid="hard-gate-note">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="t-data">The page in {siteName}</h4>
        {simulated ? <Chip tone="info">Simulated</Chip> : null}
      </div>
      {screenshotDataUrl ? (
        <img src={screenshotDataUrl} alt={`The page before "${label}"`} className="w-full rounded-sm border border-line-faint" data-testid="hard-gate-screenshot" />
      ) : (
        <p className="text-small text-secondary" data-testid="hard-gate-no-screenshot">
          {loading ? "Loading the page…" : "A picture of the page was not kept."}
        </p>
      )}
      <p className="break-all text-small text-secondary" data-testid="hard-gate-address">
        {address}
      </p>
      {amount ? (
        <p className="text-body-strong tabular-nums text-primary" data-testid="hard-gate-amount">
          Amount shown on the page: {amount}
        </p>
      ) : null}
      <div>
        <Button size="sm" icon={ExternalLink} onClick={onOpenSite} data-testid="hard-gate-open-site">
          Open {siteName}
        </Button>
      </div>
    </section>
  );
}
