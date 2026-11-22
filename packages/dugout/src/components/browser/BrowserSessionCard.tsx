"use client";
/**
 * "Working in <site>" on Working now (founder, Nov 22, 2026): one hosted-browser session the team has open. The founder
 * can Watch (the page, read only), Take over (the team's steps wait while they hold the page, interactive), Hand back,
 * or Stop (ends the session). A session held for a hard gate or because the team asked shows its note and opens on the
 * page, interactive, with Hand back: pressing anything on the site is the founder's own, in the live view, never here.
 * A simulated session says "Simulated": nothing outside was done.
 *
 * Presentational: the host passes the session and runs the four calls.
 */
import { useEffect, useState } from "react";
import { Globe, Hand, Pause, Play, Square } from "lucide-react";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Icon } from "../foundation/Icon";
import { BrowserLiveView } from "./BrowserLiveView";

export interface BrowserSessionView {
  siteKey: string;
  siteName: string;
  /** The page itself; null when this reader may only watch the list, or for a simulated session. */
  liveViewUrl: string | null;
  /** The page's own address. */
  url: string | null;
  steps: number;
  held: { why: "founder" | "request" | "hard_gate" | "sign_in"; note: string } | null;
  simulated: boolean;
}

export interface BrowserSessionCardProps {
  session: BrowserSessionView;
  /** This reader may take over, hand back and stop (Development write access). */
  canControl: boolean;
  /** Open the live view on arrival (the Inbox's "Open <site>"). */
  autoOpen?: boolean;
  /** The name of the call that is on its way, if any: its button waits. */
  pending?: "takeOver" | "handBack" | "stop" | null;
  /** A control's answer that was not good, in plain words. */
  error?: string | null;
  onTakeOver: () => void;
  onHandBack: () => void;
  onStop: () => void;
}

/** Why the session is held, in a sentence the founder reads; null while the team is working. */
export function browserHeldLine(held: BrowserSessionView["held"], siteName: string): string | null {
  if (!held) return null;
  if (held.why === "founder") return "You have the page. The team is paused while you do.";
  if (held.why === "sign_in") return `${siteName} needs you to sign in. The team is paused until you do.`;
  return held.note;
}

export function BrowserSessionCard({ session, canControl, autoOpen = false, pending = null, error, onTakeOver, onHandBack, onStop }: BrowserSessionCardProps) {
  const [open, setOpen] = useState(autoOpen);
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);
  const { held } = session;
  const youHaveIt = held !== null;
  const waitingOnYou = held?.why === "hard_gate" || held?.why === "request";
  const heldLine = browserHeldLine(held, session.siteName);
  const canSee = session.simulated || session.liveViewUrl !== null;
  return (
    <section className="flex flex-col gap-2 rounded-panel border border-line-faint bg-panel-alt p-3" aria-label={`Working in ${session.siteName}`} data-testid="browser-session" data-site={session.siteKey} data-held={held?.why ?? "none"}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon icon={Globe} className="text-tertiary" />
        <h3 className="t-data text-primary">Working in {session.siteName}</h3>
        {session.simulated ? <Chip tone="info">Simulated</Chip> : null}
        {waitingOnYou ? <Chip tone="warn">Waiting for you</Chip> : youHaveIt ? <Chip tone="neutral">Paused</Chip> : <Chip tone="good">Working</Chip>}
        <span className="ml-auto text-small tabular-nums text-secondary">{session.steps === 1 ? "1 step" : `${session.steps} steps`}</span>
      </div>
      {heldLine ? (
        <p className="text-body text-pretty text-primary" data-testid="browser-session-held">
          {heldLine}
        </p>
      ) : (
        <p className="text-small text-secondary">The team is working in your {session.siteName} account. It asks you before it sends, posts, buys or agrees to anything.</p>
      )}
      {session.simulated ? <p className="text-small text-secondary">This session is simulated. Nothing was done in {session.siteName}.</p> : null}
      {error ? (
        <p role="alert" className="text-small text-status-bad">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {canSee ? (
          <Button size="sm" variant={waitingOnYou ? "primary" : "default"} icon={Play} onClick={() => setOpen(true)} data-testid="browser-session-watch">
            {waitingOnYou ? `Open ${session.siteName}` : "Watch"}
          </Button>
        ) : null}
        {canControl ? (
          <>
            {youHaveIt ? (
              <Button size="sm" variant="default" icon={Hand} loading={pending === "handBack"} onClick={onHandBack} data-testid="browser-session-hand-back">
                Hand back
              </Button>
            ) : (
              <Button size="sm" variant="default" icon={Pause} loading={pending === "takeOver"} onClick={onTakeOver} data-testid="browser-session-take-over">
                Take over
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={Square} loading={pending === "stop"} onClick={onStop} data-testid="browser-session-stop">
              Stop
            </Button>
          </>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="xl" data-testid="browser-session-dialog" data-interactive={youHaveIt ? "true" : "false"}>
          <DialogHeader>
            <DialogTitle>{youHaveIt ? `You have the page in ${session.siteName}` : `Watching ${session.siteName}`}</DialogTitle>
            <DialogDescription>{youHaveIt ? "The team is paused while you have the page. Press Hand back when you are done." : "You are watching. Take over to use the page yourself; the team pauses while you do."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-2">
            {heldLine && youHaveIt ? <p className="text-body text-pretty text-primary">{heldLine}</p> : null}
            <BrowserLiveView siteName={session.siteName} liveViewUrl={session.liveViewUrl} interactive={youHaveIt && canControl} pageUrl={session.url} />
          </DialogBody>
          <DialogFooter>
            {canControl ? (
              youHaveIt ? (
                <Button variant="primary" icon={Hand} loading={pending === "handBack"} onClick={onHandBack} data-testid="browser-session-dialog-hand-back">
                  Hand back
                </Button>
              ) : (
                <Button variant="primary" icon={Pause} loading={pending === "takeOver"} onClick={onTakeOver} data-testid="browser-session-dialog-take-over">
                  Take over
                </Button>
              )
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
