/**
 * Connecting a website the team can work in (founder, Nov 22, 2026): the founder's own sign-in, in two steps.
 * First, in plain words, what the team will do in the account (shown before the first site is connected, and the
 * site's own caution when its terms are not yet confirmed). Then the live view: the founder signs in themselves, code
 * and all, and presses Done; Cancel throws the unsaved sign-in away. Nobody on the team sees what is typed.
 *
 * Presentational: the stage, the address and the busy and error state come from the host (Settings › Integrations),
 * which holds the live view's address in memory for this dialog only.
 */
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../foundation/Dialog";
import { Button } from "../foundation/Button";
import { BrowserLiveView } from "./BrowserLiveView";

export type BrowserConnectStage = "intro" | "starting" | "sign_in";

export const browserIntroWords = "The team will work in this account as you. You can watch and stop it. It will ask before it sends, posts, buys or agrees to anything. Some sites do not allow this, and those are not offered. You can disconnect at any time, and the saved sign-in is deleted.";
export const browserAskFirstWords = (site: string, appName: string): string => `${appName} has not yet confirmed that ${site}'s terms allow this. Connect it only if you are comfortable with that.`;
export const browserSignInWords = (site: string): string => `Sign in to ${site} here yourself, including any code it sends you. Nobody on the team sees what you type.`;
export const BROWSER_SIMULATED_SIGN_IN = "This is a simulated sign-in. No page is opened and nothing is saved at the site. Done finishes it.";

export interface BrowserSiteConnectDialogProps {
  open: boolean;
  /** Called with false for Esc, the close button and a press outside: the host cancels the unsaved sign-in. */
  onOpenChange: (open: boolean) => void;
  siteName: string;
  /** The site's terms are not yet confirmed to allow this. */
  askFirst: boolean;
  /** Show the plain-words paragraph: before the first site is connected. */
  showIntro: boolean;
  appName: string;
  stage: BrowserConnectStage;
  /** The page itself, for this sign-in only; null in the simulated mode. */
  liveViewUrl: string | null;
  /** Why Done did not finish (the sign-in is not complete yet), in the host's words. */
  error?: string | null;
  /** A call is on its way. */
  busy?: boolean;
  onStart: () => void;
  onDone: () => void;
  onCancel: () => void;
}

export function BrowserSiteConnectDialog({ open, onOpenChange, siteName, askFirst, showIntro, appName, stage, liveViewUrl, error, busy = false, onStart, onDone, onCancel }: BrowserSiteConnectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={stage === "sign_in" ? "xl" : "md"} data-testid="browser-connect-dialog" data-stage={stage}>
        <DialogHeader>
          <DialogTitle>Connect {siteName}</DialogTitle>
          <DialogDescription>{stage === "sign_in" ? browserSignInWords(siteName) : `Work in ${siteName} through a hosted browser, in your own account.`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {stage === "sign_in" ? (
            <>
              <BrowserLiveView siteName={siteName} liveViewUrl={liveViewUrl} interactive simulatedNote={BROWSER_SIMULATED_SIGN_IN} />
              {error ? (
                <p role="alert" className="text-small text-status-bad" data-testid="browser-connect-error">
                  {error}
                </p>
              ) : null}
            </>
          ) : (
            <>
              {showIntro ? (
                <p className="text-body text-pretty text-primary" data-testid="browser-connect-intro">
                  {browserIntroWords}
                </p>
              ) : null}
              {askFirst ? (
                <p className="text-body text-pretty text-primary" data-testid="browser-connect-ask-first">
                  {browserAskFirstWords(siteName, appName)}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="text-small text-status-bad">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={busy && stage !== "sign_in"} data-testid="browser-connect-cancel">
            Cancel
          </Button>
          {stage === "sign_in" ? (
            <Button variant="primary" onClick={onDone} loading={busy} data-testid="browser-connect-done">
              Done
            </Button>
          ) : (
            <Button variant="primary" onClick={onStart} loading={busy || stage === "starting"} data-testid="browser-connect-start">
              Continue
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
