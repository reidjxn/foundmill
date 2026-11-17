"use client";
/**
 * "Not now" (founder, 2026-11-11; WP-08 T9): the channels that cannot really act for this business, shown to everyone
 * and collapsed, each with one sentence on why it waits (`channelNotNowSentence`: the week-one reason, or the API's own
 * when connecting a tool is the founder's step now). The Board and the Channels table show the rest. Where offline tracking
 * applies (the channel's own setting) the channel can still be put on the board: the team prepares the materials and
 * the founder submits them. A channel left on the board from before, which cannot run, can be taken off here.
 */
import { ArrowDownToLine, ArrowUpToLine, ChevronRight, Plug } from "lucide-react";
import { Button, Chip, Panel } from "@foundmill/dugout";
import { CHANNELS_NOT_AVAILABLE_TITLE, channelNotNowSentence } from "@foundmill/shared/channel-availability";
import type { ChannelView } from "./channel-data";
import { OFFLINE_TRACKING_LABEL, channelLabel } from "./shared";

/** Said once under the title: why these are apart, and that it is nobody's fault. */
export const NOT_AVAILABLE_INTRO = "These channels wait for later. Nothing is wrong: each opens as soon as it can really reach people.";
/** The summary line of the collapsed list. */
export const NOT_NOW_SHOW = (n: number) => `Show ${n} channel${n === 1 ? "" : "s"} for later`;
/** What offline tracking means, on a channel that can be turned on with it. */
export const OFFLINE_TRACKING_OFFER = "With offline tracking the team prepares the materials and you submit them yourself.";
export const PUT_ON_WITH_OFFLINE_LABEL = "Put on the board with offline tracking";
/** A channel that was put on the board before and cannot run. */
export const ON_BOARD_NOT_RUNNING = "On the board, not running";

export interface NotAvailableChannelsProps {
  /** The channels that are not available (`splitByAvailability(views).unavailable`). */
  views: readonly ChannelView[];
  /** The key of the toggle in flight (`toggle:<channelKey>`), for the button's loading state. */
  pending?: string | null;
  onToggle: (view: ChannelView, enabled: boolean) => void;
  /** Opens Settings › Integrations, for a channel whose connection the founder can make now. */
  onOpenIntegrations?: () => void;
}

export function NotAvailableChannels({ views, pending, onToggle, onOpenIntegrations }: NotAvailableChannelsProps) {
  if (views.length === 0) return null;
  return (
    <Panel span={12} title={CHANNELS_NOT_AVAILABLE_TITLE} meta={`${views.length} channel${views.length === 1 ? "" : "s"}`} data-testid="channels-not-available">
      <p className="mb-2 max-w-reading text-small text-secondary">{NOT_AVAILABLE_INTRO}</p>
      <details className="group/notnow">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-small text-secondary transition-colors duration-hover ease-out hover:text-primary [&::-webkit-details-marker]:hidden" data-testid="channels-not-now-toggle">
          <ChevronRight size={14} aria-hidden className="transition-transform duration-overlay ease-out group-open/notnow:rotate-90" />
          {NOT_NOW_SHOW(views.length)}
        </summary>
        <ul className="flex flex-col divide-y divide-subtle/50" aria-label={CHANNELS_NOT_AVAILABLE_TITLE}>
          {views.map((v) => {
            const label = v.meta?.label ?? channelLabel(v.channelKey);
            const busy = pending === `toggle:${v.channelKey}`;
            const connectable = v.availability.reason === "not_connected" && v.availability.connectable === true;
            return (
              <li key={v.channelKey} data-channel-unavailable={v.channelKey} data-reason={v.availability.reason} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-body-strong text-primary">
                    {label}
                    {v.kitMode ? <Chip tone="info">{OFFLINE_TRACKING_LABEL}</Chip> : null}
                    {v.enabled ? <Chip tone="neutral">{ON_BOARD_NOT_RUNNING}</Chip> : null}
                  </p>
                  <p className="text-small text-secondary">
                    {channelNotNowSentence(v.channelKey, v.availability)}
                    {v.kitMode && !v.enabled ? ` ${OFFLINE_TRACKING_OFFER}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {connectable && onOpenIntegrations ? (
                    <Button size="sm" variant="ghost" icon={Plug} onClick={onOpenIntegrations}>
                      Open Integrations
                    </Button>
                  ) : null}
                  {v.enabled ? (
                    <Button size="sm" variant="ghost" icon={ArrowDownToLine} loading={busy} onClick={() => onToggle(v, false)}>
                      Take off the board
                    </Button>
                  ) : v.kitMode ? (
                    <Button size="sm" icon={ArrowUpToLine} loading={busy} onClick={() => onToggle(v, true)}>
                      {PUT_ON_WITH_OFFLINE_LABEL}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </details>
    </Panel>
  );
}
