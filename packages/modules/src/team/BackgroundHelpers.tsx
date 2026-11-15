"use client";
/**
 * The background helpers, kept out of the founder's lists and counts (Leads first, 2026-11-08) but never hidden: one
 * honest line ("5 background helpers also run, … Show them") that opens a read-only list with each helper's status, when
 * it was last active and its profile. Helpers always read by their role name (`agentDisplay`), so the list shows the
 * stored name.
 */
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Avatar, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, formatRelative } from "@foundmill/dugout";
import { backgroundHelpersLine } from "@foundmill/shared";
import { useWidgetData } from "@foundmill/widgets/data";
import { AgentStatusWordPill, agentDept, agentHref, agentRoleLine, toDate } from "./shared";
import type { AgentRow } from "./types";

export interface BackgroundHelpersLineProps {
  businessId: string;
  /** The live background helpers (`teamTree(…).background`). */
  helpers: readonly AgentRow[];
  now: Date;
  className?: string;
}

/** The line and its read-only list; nothing when the business runs no helper. */
export function BackgroundHelpersLine({ businessId, helpers, now, className }: BackgroundHelpersLineProps) {
  const { navigate } = useWidgetData();
  const [open, setOpen] = useState(false);
  if (helpers.length === 0) return null;
  return (
    <>
      <span className={className} data-testid="background-helpers-line">
        {backgroundHelpersLine(helpers.length)}{" "}
        <Button size="sm" variant="ghost" className="-my-1 h-auto px-1 py-0 align-baseline text-small" onClick={() => setOpen(true)} data-testid="background-helpers-show">
          Show them
        </Button>
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md" data-testid="background-helpers-dialog">
          <DialogHeader>
            <DialogTitle>Background helpers</DialogTitle>
            <DialogDescription>They run on their own, linking names, sorting what comes in and checking drafts. They never take tasks or write to you, so they are not in the team's lists or its health.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <ul className="flex flex-col divide-y divide-line-faint" aria-label="Background helpers">
              {helpers.map((h) => {
                const seen = toDate(h.health?.lastHeartbeatAt ?? null);
                const role = agentRoleLine(h);
                return (
                  <li key={h.id} className="flex min-w-0 items-center gap-2.5 py-2" data-agent-id={h.id}>
                    <Avatar size={24} name={h.name} agent={{ seed: h.avatarSeed || h.id, dept: agentDept(h), layer: "utility" }} status={h.status} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-strong text-primary">{h.name}</span>
                      {role ? <span className="truncate text-small text-secondary">{role}</span> : null}
                    </span>
                    <AgentStatusWordPill status={h.status} expectedReturnAt={h.expectedReturnAt ?? h.health?.expectedReturnAt} now={now} withReturn={false} className="shrink-0" />
                    <span className="w-28 shrink-0 text-right text-small text-secondary tabular-nums">{seen ? `Active ${formatRelative(seen, now)}` : "Not active yet"}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={ExternalLink}
                      className="shrink-0"
                      aria-label={`Open ${h.name}'s profile`}
                      onClick={() => {
                        setOpen(false);
                        navigate(agentHref(businessId, h.id));
                      }}
                    >
                      Profile
                    </Button>
                  </li>
                );
              })}
            </ul>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
