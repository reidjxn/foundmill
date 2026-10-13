"use client";
/**
 * Channel profile (BUILD §11.7 "Click → channel profile": agents, budget, rules, results, pause), shown in the right
 * rail of the Formation tab. Reuses Dugout's ChannelProfileCard for the token facts and adds the budget editor,
 * the guardrails, the channel's campaigns and the Strategist's "why".
 */
import { useEffect, useId, useState } from "react";
import { ArrowRight, Save } from "lucide-react";
import { Button, ChannelProfileCard, Field, Markdown, MoneyInput, RightRail, StatusPill, formatMoney, type ChannelTokenData } from "@foundmill/dugout";
import type { ChannelKey } from "@foundmill/shared";
import { CAMPAIGN_STATUS_WORDS, CHANNEL_RULES, SHARED_RULES, approvalThresholdMinor, type ChannelView } from "./channel-data";
import { InlineError, parseMajor, type ActionState } from "./shared";

export interface ChannelProfileDrawerProps {
  view: ChannelView | null;
  token: ChannelTokenData | null;
  action: ActionState;
  onClose: () => void;
  onToggle: (key: ChannelKey, enabled: boolean) => void;
  onPause: (key: ChannelKey, paused: boolean) => void;
  onBudgetSaved: () => void;
  /** Navigate to the Channels tab row for this channel. */
  onOpenChannels?: (key: ChannelKey) => void;
}

export function ChannelProfileDrawer({ view, token, action, onClose, onToggle, onPause, onBudgetSaved, onOpenChannels }: ChannelProfileDrawerProps) {
  const budgetId = useId();
  const [budget, setBudget] = useState("");
  useEffect(() => {
    setBudget(view ? String(Math.round(view.budgetMinor / 100)) : "");
  }, [view?.id, view?.budgetMinor, view]);

  const open = !!view && !!token;
  const saveBudget = async () => {
    if (!view?.id) return;
    const major = parseMajor(budget);
    if (major === null || major < 0) return;
    const ok = await action.run("distribution.channels.budget", { channelId: view.id, budgetMinor: Math.round(major * 100), currency: view.currency }, { key: `budget:${view.id}` });
    if (ok !== undefined) onBudgetSaved();
  };
  const budgetDirty = !!view && parseMajor(budget) !== Math.round(view.budgetMinor / 100);

  return (
    <RightRail
      title={view ? view.meta?.label ?? view.channelKey : "Channel profile"}
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      hideToggle={!open}
      actions={
        open ? (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        ) : null
      }
      className="h-full"
    >
      {view && token ? (
        <div className="flex flex-col gap-4" data-channel-drawer={view.channelKey}>
          <ChannelProfileCard channel={token} onToggle={onToggle} onPause={onPause} />
          {/* The card above carries the Offline tracking chip (the channel's own setting); this says what it means. */}
          {view.kitMode ? <p className="text-small text-secondary">Offline tracking: bookings become a founder task with every material attached; nothing is booked by an agent.</p> : null}

          <section aria-labelledby={`${budgetId}-h`} className="flex flex-col gap-2 border-t border-subtle pt-3">
            <h3 id={`${budgetId}-h`} className="t-title text-primary">
              Budget
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <Field htmlFor={budgetId} label="Monthly budget" className="min-w-0 flex-1">
                <MoneyInput id={budgetId} controlSize="md" currency={view.currency} value={budget} onValueChange={setBudget} disabled={!view.persisted} aria-describedby={`${budgetId}-hint`} />
              </Field>
              <Button size="md" icon={Save} loading={action.pending === `budget:${view.id}`} disabled={!view.persisted || !budgetDirty} onClick={saveBudget}>
                Save budget
              </Button>
            </div>
            <p id={`${budgetId}-hint`} className="text-small text-secondary">
              {view.persisted
                ? `Current ${formatMoney({ amountMinor: view.budgetMinor, currency: view.currency })}. Engines spend within this share; anything above ${formatMoney({ amountMinor: approvalThresholdMinor(), currency: view.currency })} in one commitment goes to the Inbox.`
                : "Ask the Strategist for a recommendation first; unscored channels have no budget line yet."}
            </p>
            <InlineError error={action.pending === null && action.error ? action.error : null} />
          </section>

          <section aria-label="Rules" className="flex flex-col gap-1 border-t border-subtle pt-3">
            <h3 className="t-title text-primary">Rules</h3>
            <ul className="flex list-disc flex-col gap-0.5 pl-4 text-small text-primary">
              {CHANNEL_RULES[view.channelKey].map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
              {SHARED_RULES.map((rule) => (
                <li key={rule} className="text-secondary">
                  {rule}
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Campaigns" className="flex flex-col gap-1 border-t border-subtle pt-3">
            <h3 className="t-title text-primary">Campaigns</h3>
            {view.campaigns.length === 0 ? (
              <p className="text-small text-secondary">No campaigns yet. The engine plans the first one once the channel is running.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {view.campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-small">
                    <span className="min-w-0 truncate text-primary" title={c.name}>
                      {c.name}
                    </span>
                    <StatusPill tone={CAMPAIGN_STATUS_WORDS[c.status].tone} className="shrink-0 whitespace-nowrap">
                      {CAMPAIGN_STATUS_WORDS[c.status].word}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {view.why ? (
            <section aria-label="Why this channel" className="flex flex-col gap-1 border-t border-subtle pt-3">
              <h3 className="t-title text-primary">Why this channel</h3>
              <Markdown variant="body">{view.why}</Markdown>
            </section>
          ) : null}

          {onOpenChannels ? (
            <div className="border-t border-subtle pt-3">
              <Button size="sm" variant="ghost" iconRight={ArrowRight} onClick={() => onOpenChannels(view.channelKey)}>
                Open in Channels
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </RightRail>
  );
}
