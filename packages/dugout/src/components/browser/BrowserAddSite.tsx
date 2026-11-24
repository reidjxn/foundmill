"use client";
/**
 * "Add any website" (Settings › Integrations; founder, Nov 24, 2026): the founder types a site's address, Foundmill reads
 * its terms and says what it found. A refused site (a social network, a bank or payment account, terms that forbid
 * automated use) is shown with the reason and, for terms, the line that says so. A site whose terms do not say gets the
 * honest line and the founder's own yes before Connect. Starter sites are shown first, only those whose terms check passes.
 * Presentational: the host runs the check and the connect.
 */
import { useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { Button } from "../foundation/Button";
import { Checkbox } from "../foundation/Checkbox";
import { Chip } from "../foundation/Chip";
import { Input } from "../foundation/Input";

export interface BrowserStarter {
  name: string;
  address: string;
}

/** What checking an address found (the api's `browser.checkSite`). */
export type BrowserSiteAnswer =
  | { status: "refused"; name: string; message: string; quote: string | null; termsUrl: string | null }
  | { status: "ask_first" | "open"; name: string; address: string; line: string; quote: string | null; termsUrl: string | null; simulated: boolean; slotKey: string };

export const BROWSER_ADD_INTRO = "Type the address of a website you already use. We read its terms first and tell you what we found.";
export const BROWSER_ADD_NEVER_WORDS = "Social networks, banks and payment accounts are never added.";
export const browserUnconfirmedYes = (name: string): string => `I understand that ${name}'s terms do not say either way, and I want the team to work in it.`;

export interface BrowserAddSiteProps {
  starters: readonly BrowserStarter[];
  /** The address in the field. */
  address: string;
  onAddressChange: (address: string) => void;
  /** Check the typed address (Enter, the button, or a starter chip). */
  onCheck: (address: string) => void;
  checking?: boolean;
  answer: BrowserSiteAnswer | null;
  /** Connect the checked site; `acceptedUnconfirmed` is the founder's own yes for a site whose terms do not say. */
  onConnect: (answer: Extract<BrowserSiteAnswer, { status: "ask_first" | "open" }>, acceptedUnconfirmed: boolean) => void;
  connecting?: boolean;
  /** An error from the check itself (the gateway could not read the site), in the host's words. */
  error?: string | null;
  disabled?: boolean;
}

export function BrowserAddSite({ starters, address, onAddressChange, onCheck, checking = false, answer, onConnect, connecting = false, error = null, disabled = false }: BrowserAddSiteProps) {
  const [accepted, setAccepted] = useState<string | null>(null);
  const yes = answer && answer.status === "ask_first" && accepted === answer.address;
  return (
    <div className="flex flex-col gap-3" data-testid="browser-add-site">
      <div className="flex flex-col gap-1">
        <span className="text-body-strong text-primary">Add any website</span>
        <p className="text-small text-pretty text-secondary">{BROWSER_ADD_INTRO}</p>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (address.trim() && !disabled) onCheck(address.trim());
        }}
      >
        <Input className="flex-1" icon={Globe} placeholder="shop.example.com" aria-label="Website address" value={address} onChange={(e) => onAddressChange(e.target.value)} disabled={disabled} data-testid="browser-add-address" />
        <Button type="submit" size="sm" loading={checking} disabled={disabled || address.trim() === ""} data-testid="browser-add-check">
          Check
        </Button>
      </form>
      {starters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="browser-starters">
          {starters.map((s) => (
            <button key={s.address} type="button" disabled={disabled || checking} onClick={() => (onAddressChange(s.address), onCheck(s.address))} data-testid={`browser-starter-${s.address}`} className="rounded-full">
              <Chip tone="neutral">{s.name}</Chip>
            </button>
          ))}
        </div>
      ) : null}
      <p className="text-small text-tertiary" data-testid="browser-add-never">
        {BROWSER_ADD_NEVER_WORDS}
      </p>
      {error ? (
        <p role="alert" className="text-small text-status-bad" data-testid="browser-add-error">
          {error}
        </p>
      ) : null}
      {answer?.status === "refused" ? (
        <div role="status" className="flex flex-col gap-1 border-l-2 border-status-bad pl-3" data-testid="browser-add-refused">
          <span className="text-body-strong text-primary">{answer.name} cannot be added</span>
          <span className="text-small text-pretty text-secondary">{answer.message}</span>
          {answer.quote ? (
            <figure className="flex flex-col gap-1">
              <figcaption className="text-small text-tertiary">A line from its terms, in the site's own words:</figcaption>
              <blockquote className="text-small text-pretty text-primary" data-testid="browser-add-quote">“{answer.quote}”</blockquote>
            </figure>
          ) : null}
          {answer.termsUrl ? (
            <a className="inline-flex items-center gap-1 text-small text-secondary underline" href={answer.termsUrl} target="_blank" rel="noreferrer noopener">
              Read its terms <ExternalLink size={12} aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}
      {answer && answer.status !== "refused" ? (
        <div role="status" className="flex flex-col gap-2 border-l-2 border-line pl-3" data-testid="browser-add-found" data-status={answer.status}>
          <span className="text-body-strong text-primary">{answer.name}</span>
          <span className="text-small text-pretty text-secondary" data-testid="browser-add-line">
            {answer.line}
          </span>
          {answer.quote ? (
            <figure className="flex flex-col gap-1" data-testid="browser-add-found-quote">
              <figcaption className="text-small text-tertiary">A line from its terms, in the site's own words:</figcaption>
              <blockquote className="text-small text-pretty text-primary">“{answer.quote}”</blockquote>
            </figure>
          ) : null}
          {answer.termsUrl ? (
            <a className="inline-flex items-center gap-1 text-small text-secondary underline" href={answer.termsUrl} target="_blank" rel="noreferrer noopener">
              Read its terms <ExternalLink size={12} aria-hidden />
            </a>
          ) : null}
          {answer.status === "ask_first" ? (
            <label className="flex items-start gap-2 text-small text-pretty text-primary">
              <Checkbox checked={yes === true} onCheckedChange={(c) => setAccepted(c === true ? answer.address : null)} className="mt-0.5" data-testid="browser-add-accept" aria-label={browserUnconfirmedYes(answer.name)} />
              <span>{browserUnconfirmedYes(answer.name)}</span>
            </label>
          ) : null}
          <div>
            <Button size="sm" variant="primary" loading={connecting} disabled={disabled || (answer.status === "ask_first" && !yes)} onClick={() => onConnect(answer, answer.status === "ask_first")} data-testid="browser-add-connect">
              Connect {answer.name}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
