/**
 * The live view of a hosted-browser session: the page itself in a frame. The address is the page, so whoever holds it
 * controls the session: it is passed in for this view only and never put in a link or a log. `interactive` false is
 * watching (pointer-events-none: clicks and keys reach nothing; the frame leaves the tab order); true is the founder's
 * own hands on the page. With no address (the recorded mock's simulated session) a plain panel says so.
 */
import { MonitorPlay } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";

export interface BrowserLiveViewProps {
  siteName: string;
  /** The page itself; null for a simulated session. */
  liveViewUrl: string | null;
  interactive: boolean;
  /** The page's own address, for the caption (never the live view's). */
  pageUrl?: string | null;
  /** The panel for a session with no address says what was simulated. */
  simulatedNote?: string;
  className?: string;
}

/** The permissions the frame gets: its own scripts and storage, and the clipboard for pasting a code. Nothing more. */
export const LIVE_VIEW_SANDBOX = "allow-same-origin allow-scripts";
export const LIVE_VIEW_ALLOW = "clipboard-read; clipboard-write";

/** Only E2B's own sandbox hosts are framed (`<port>-<sandbox id>.e2b.app`, https): any other address shows the panel. */
export function isLiveViewAddress(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && /^\d{2,5}-[a-z0-9]{8,40}\.e2b\.(app|dev)$/.test(u.hostname);
  } catch {
    return false;
  }
}

export function BrowserLiveView({ siteName, liveViewUrl, interactive, pageUrl, simulatedNote, className }: BrowserLiveViewProps) {
  if (!isLiveViewAddress(liveViewUrl)) {
    return (
      <div className={cn("flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-panel border border-line-faint bg-ink p-6 text-center", className)} data-testid="browser-live-view-simulated">
        <Icon icon={MonitorPlay} size="lg" className="text-tertiary" />
        <p className="text-body-strong text-primary">Simulated</p>
        <p className="max-w-prose text-small text-pretty text-secondary">{simulatedNote ?? `This is a simulated session in ${siteName}. No page is open and nothing outside was done.`}</p>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <iframe
        title={interactive ? `${siteName}, interactive` : `${siteName}, watching`}
        src={liveViewUrl!}
        sandbox={LIVE_VIEW_SANDBOX}
        allow={LIVE_VIEW_ALLOW}
        tabIndex={interactive ? 0 : -1}
        className={cn("aspect-video w-full rounded-panel border border-line-faint bg-ink", !interactive && "pointer-events-none")}
        data-testid="browser-live-view"
        data-interactive={interactive ? "true" : "false"}
      />
      {pageUrl ? (
        <p className="truncate text-small text-tertiary" data-testid="browser-live-view-address">
          {pageUrl}
        </p>
      ) : null}
    </div>
  );
}
