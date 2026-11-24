"use client";
/**
 * "Add a website the team can work in" (Settings › Integrations; founder, Nov 22, 2026): each site on the site list with
 * its state. Not connected: Connect. Connected: "Signed in to <site>", its health ("Sign in again" when the site signed
 * the saved sign-in out: one button, never a retry loop) and Disconnect, which deletes the saved sign-in. Sites that are
 * never offered are named by kind, not listed.
 */
import { Globe, LogIn, Unplug } from "lucide-react";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { IconButton } from "../foundation/IconButton";

export interface BrowserSiteRow {
  connectorKey: string;
  siteKey: string;
  name: string;
  /** Not yet confirmed to allow this: the dialog says so before the founder connects. */
  askFirst: boolean;
  /** A website the founder typed in: its address, sent back when they sign in again. Absent for a site on the list. */
  address?: string;
  status: "not_connected" | "connected" | "expired" | "blocked";
}

export const BROWSER_NEVER_WORDS = "Banks, brokerages, payment accounts, social networks, government and identity sites, health records and password managers are never offered.";
export const BROWSER_DISCONNECT_WORDS = "Disconnect deletes the saved sign-in.";

export interface BrowserSitesListProps {
  sites: readonly BrowserSiteRow[];
  /** This reader may connect and disconnect (administration). */
  canEdit: boolean;
  /** The connector key whose call is on its way. */
  pendingKey?: string | null;
  onConnect: (site: BrowserSiteRow) => void;
  onDisconnect: (site: BrowserSiteRow) => void;
}

export function BrowserSitesList({ sites, canEdit, pendingKey = null, onConnect, onDisconnect }: BrowserSitesListProps) {
  return (
    <div className="flex flex-col gap-2" data-testid="browser-sites">
      <p className="text-small text-pretty text-secondary">When a tool has no connection of its own, the team can work in its website, in the account you sign in to. You watch and stop it, and it stops and asks you before it buys, pays, agrees to terms or deletes anything.</p>
      <ul className="flex flex-col" data-testid="browser-site-list">
        {sites.map((s) => {
          const connected = s.status !== "not_connected";
          return (
            <li key={s.connectorKey} className="flex min-h-row-comfortable items-center gap-3 border-b border-line-faint py-2 last:border-b-0" data-browser-site={s.siteKey} data-status={s.status}>
              <Icon icon={Globe} className="shrink-0 text-tertiary" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-strong text-primary">{s.name}</span>
                {s.status === "connected" ? <span className="text-small text-secondary">Signed in to {s.name}</span> : null}
                {s.status === "blocked" ? <span className="text-small text-secondary" data-testid={`browser-blocked-${s.siteKey}`}>{s.name} is no longer allowed: its terms or its kind of site changed. The team has stopped working in it. Disconnect it.</span> : null}
                {s.status === "expired" ? <span className="text-small text-secondary">{s.name} signed you out. Sign in again so the team can keep working.</span> : null}
                {connected ? <span className="text-small text-tertiary">{BROWSER_DISCONNECT_WORDS}</span> : null}
              </div>
              {s.status === "blocked" ? <Chip tone="warn">No longer allowed</Chip> : s.status === "expired" ? <Chip tone="warn">Signed out</Chip> : s.status === "connected" ? <Chip tone="good">Signed in</Chip> : s.askFirst ? <Chip tone="neutral">Ask first</Chip> : null}
              {canEdit ? (
                connected ? (
                  <>
                    {s.status === "expired" ? (
                      <Button size="sm" icon={LogIn} loading={pendingKey === s.connectorKey} onClick={() => onConnect(s)} data-testid={`browser-sign-in-again-${s.siteKey}`}>
                        Sign in again
                      </Button>
                    ) : null}
                    <IconButton label={`Disconnect ${s.name}`} icon={Unplug} size="sm" disabled={pendingKey === s.connectorKey} onClick={() => onDisconnect(s)} data-testid={`browser-disconnect-${s.siteKey}`} />
                  </>
                ) : (
                  <Button size="sm" loading={pendingKey === s.connectorKey} onClick={() => onConnect(s)} data-testid={`browser-connect-${s.siteKey}`}>
                    Connect
                  </Button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-small text-pretty text-secondary" data-testid="browser-never">
        {BROWSER_NEVER_WORDS}
      </p>
    </div>
  );
}
