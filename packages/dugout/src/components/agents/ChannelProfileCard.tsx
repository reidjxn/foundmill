"use client";
import { ArrowDownToLine, ArrowUpToLine, ExternalLink, Pause, Play } from "lucide-react";
import { CHANNEL_META, type ChannelKey } from "@foundmill/shared/constants";
import { cn } from "../../lib/cn";
import { formatMoney, formatPercent } from "../../lib/format";
import { AvatarStack } from "../foundation/Avatar";
import { Button } from "../foundation/Button";
import { Chip, ProvenanceChip } from "../foundation/Chip";
import { Icon } from "../foundation/Icon";
import { StarRating } from "../foundation/StarRating";
import { RatingFigure } from "../data/RatingBar";
import { FormGuide } from "./ChannelToken";
import { CHANNEL_ICONS, LINE_LABELS, channelLine } from "./formation";
import type { ChannelTokenData } from "./types";

export interface ChannelProfileCardProps {
  channel: ChannelTokenData;
  onOpenChannel?: (key: ChannelKey) => void;
  onToggle?: (key: ChannelKey, enabled: boolean) => void;
  onPause?: (key: ChannelKey, paused: boolean) => void;
  className?: string;
}

/** Channel profile (BUILD §11.7 "Click → channel profile"): agents, budget, rules, results, pause. Fits a hover card or a rail. */
export function ChannelProfileCard({ channel, onOpenChannel, onToggle, onPause, className }: ChannelProfileCardProps) {
  const meta = CHANNEL_META[channel.key];
  const line = channelLine(channel.key);
  return (
    <div className={cn("flex w-full flex-col gap-2 text-body", className)} data-channel-profile={channel.key}>
      <div className="flex items-center gap-2">
        <span className="inline-flex size-8 items-center justify-center rounded-full bg-panel text-primary">
          <Icon icon={CHANNEL_ICONS[channel.key]} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="t-display-sm truncate text-primary">{meta.label}</p>
          <p className="text-small text-secondary">
            {LINE_LABELS[line]} · {meta.coreMetric}
          </p>
        </div>
        <div className="flex flex-col items-end">
          <RatingFigure value={channel.fit} />
          <span className="t-label">Fit</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {channel.recommended ? <Chip tone="kit">Recommended</Chip> : null}
        <Chip tone={channel.enabled ? "good" : "neutral"}>{channel.enabled ? "On the board" : "Off the board"}</Chip>
        {channel.paused ? <Chip tone="warn">Paused</Chip> : null}
        {meta.kitModeByDefault ? <Chip tone="info">Offline tracking</Chip> : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {channel.potential !== undefined ? (
          <div>
            <dt className="t-label">Potential</dt>
            <dd>
              <StarRating value={channel.potential} label="Potential" showValue />
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="t-label">Form</dt>
          <dd className="pt-1">
            <FormGuide form={channel.form} name={`${meta.label} form`} />
          </dd>
        </div>
        {channel.cpaRange ? (
          <div className="col-span-2">
            <dt className="t-label">Cost per customer</dt>
            <dd className="inline-flex items-center gap-1.5 tabular-nums">
              {formatMoney(channel.cpaRange.low)} – {formatMoney(channel.cpaRange.high)} <ProvenanceChip kind="estimate" />
            </dd>
          </div>
        ) : null}
        {channel.budgetShare !== undefined && channel.enabled ? (
          <div>
            <dt className="t-label">Budget share</dt>
            <dd className="tabular-nums">{formatPercent(channel.budgetShare, { digits: 0 })}</dd>
          </div>
        ) : null}
        {channel.agents && channel.agents.length > 0 ? (
          <div>
            <dt className="t-label">Agents</dt>
            <dd className="flex items-center gap-1.5">
              <AvatarStack items={channel.agents.map((a) => ({ name: a.name, agent: { seed: a.seed, dept: a.dept }, status: a.status }))} size={20} />
              <span className="text-small text-secondary">{channel.agents.map((a) => a.name).join(", ")}</span>
            </dd>
          </div>
        ) : null}
      </dl>
      {channel.why ? <p className="text-small text-secondary">{channel.why}</p> : null}
      {channel.results && channel.results.length > 0 ? (
        <ul className="flex flex-col gap-0.5 border-t border-subtle pt-2 text-small">
          {channel.results.map((r) => (
            <li key={r.label} className="flex justify-between gap-2">
              <span className="text-secondary">{r.label}</span>
              <span className="tabular-nums text-primary">{r.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {onOpenChannel || onToggle || onPause ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-subtle pt-2">
          {onOpenChannel ? (
            <Button size="sm" variant="primary" icon={ExternalLink} onClick={() => onOpenChannel(channel.key)}>
              Open channel
            </Button>
          ) : null}
          {onToggle ? (
            <Button size="sm" icon={channel.enabled ? ArrowDownToLine : ArrowUpToLine} onClick={() => onToggle(channel.key, !channel.enabled)}>
              {channel.enabled ? "Take off the board" : "Put on the board"}
            </Button>
          ) : null}
          {onPause && channel.enabled ? (
            <Button size="sm" variant="ghost" icon={channel.paused ? Play : Pause} onClick={() => onPause(channel.key, !channel.paused)}>
              {channel.paused ? "Resume" : "Pause"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
