"use client";
/**
 * Distribution › Campaigns dialogs: New campaign and Edit campaign (name, objective, budget, dates) over
 * `distribution.campaigns.create` / `update`, and the confirmation that ending a campaign asks for (an ended campaign
 * has no way back, `CAMPAIGN_TRANSITIONS.ended` is empty). A new campaign starts as a draft: it launches from the
 * Campaigns tab once an asset is approved.
 */
import { useEffect, useState } from "react";
import { CircleStop, Save } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, MoneyInput, SimpleSelect, Textarea } from "@foundmill/dugout";
import { InlineError, channelLabel, parseMajor, useAction } from "./shared";
import type { CampaignRow, ChannelRow } from "./types";

export interface CampaignDraft {
  channelId: string;
  name: string;
  goal: string;
  /** Major units as typed ("2,500", "2.5k"). */
  budget: string;
  /** YYYY-MM-DD in the founder's own calendar, or "" for none. */
  startsAt: string;
  endsAt: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A stored moment → the day a date field shows, in the founder's own time zone. */
export function toDayInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A date field's day → the moment it starts in the founder's own time zone (null when empty). */
export function fromDayInput(day: string): string | null {
  if (!day) return null;
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function draftFromCampaign(campaign: CampaignRow | null, channelId = ""): CampaignDraft {
  if (!campaign) return { channelId, name: "", goal: "", budget: "", startsAt: "", endsAt: "" };
  return { channelId: campaign.channelId, name: campaign.name, goal: campaign.goal ?? "", budget: campaign.budgetMinor ? String(campaign.budgetMinor / 100) : "", startsAt: toDayInput(campaign.startsAt), endsAt: toDayInput(campaign.endsAt) };
}

/** What stops the draft from saving, in words; null when it can. */
export function validateCampaignDraft(d: CampaignDraft, opts: { creating: boolean }): string | null {
  if (!d.name.trim()) return "Give the campaign a name.";
  if (opts.creating && !d.channelId) return "Pick the channel that runs it.";
  if (d.budget.trim()) {
    const major = parseMajor(d.budget);
    if (major === null || major < 0) return "Enter the budget as an amount, for example 2,500.";
  }
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) return "The end date is before the start date.";
  return null;
}

/** The fields `campaigns.create` and `campaigns.update` share (no status: a new campaign is a draft). */
export function campaignFields(d: CampaignDraft, currency: string): { name: string; goal: string; budgetMinor: number; currency: string; startsAt: string | null; endsAt: string | null } {
  const major = d.budget.trim() ? (parseMajor(d.budget) ?? 0) : 0;
  return { name: d.name.trim(), goal: d.goal.trim(), budgetMinor: Math.round(Math.max(0, major) * 100), currency, startsAt: fromDayInput(d.startsAt), endsAt: fromDayInput(d.endsAt) };
}

export interface CampaignDialogProps {
  open: boolean;
  /** The campaign to edit; null for a new one. */
  campaign: CampaignRow | null;
  /** Channels a new campaign can run on (the ones on the board). */
  channels: readonly ChannelRow[];
  /** The business currency, for a new campaign. */
  currency: string;
  onClose: () => void;
  onSaved: (campaign: CampaignRow) => void;
}

export function CampaignDialog({ open, campaign, channels, currency, onClose, onSaved }: CampaignDialogProps) {
  const creating = !campaign;
  const [draft, setDraft] = useState<CampaignDraft>(() => draftFromCampaign(campaign, channels[0]?.id));
  const [touched, setTouched] = useState(false);
  const action = useAction();
  useEffect(() => {
    if (open) {
      setDraft(draftFromCampaign(campaign, channels[0]?.id));
      setTouched(false);
      action.clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset each time the dialog opens
  }, [open, campaign?.id]);
  const problem = validateCampaignDraft(draft, { creating });
  const money = campaign?.currency ?? channels.find((c) => c.id === draft.channelId)?.currency ?? currency;

  const save = async () => {
    setTouched(true);
    if (problem) return;
    const fields = campaignFields(draft, money);
    const saved = creating
      ? await action.run<CampaignRow>("distribution.campaigns.create", { channelId: draft.channelId, ...fields }, { key: "save" })
      : await action.run<CampaignRow>("distribution.campaigns.update", { campaignId: campaign.id, patch: fields }, { key: "save" });
    if (saved !== undefined) {
      onSaved(saved);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" data-campaign-dialog={creating ? "new" : campaign.id}>
        <DialogHeader>
          <DialogTitle>{creating ? "New campaign" : `Edit ${campaign.name}`}</DialogTitle>
          <DialogDescription>{creating ? "A new campaign starts as a draft. Launch it once at least one of its assets is approved." : "Changes apply from now on; the campaign keeps its status."}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid grid-cols-2 gap-3">
          {creating ? (
            <Field htmlFor="campaign-channel" label="Channel" required className="col-span-2" hint={channels.length ? undefined : "Put a channel on the board first."}>
              <SimpleSelect id="campaign-channel" value={draft.channelId} onValueChange={(v) => setDraft({ ...draft, channelId: v })} options={channels.map((c) => ({ value: c.id, label: channelLabel(c.channelKey) }))} />
            </Field>
          ) : null}
          <Field htmlFor="campaign-name" label="Name" required className="col-span-2" error={touched && !draft.name.trim() ? "Required" : undefined}>
            <Input id="campaign-name" value={draft.name} maxLength={160} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
          </Field>
          <Field htmlFor="campaign-goal" label="Objective" className="col-span-2">
            <Textarea id="campaign-goal" rows={3} maxLength={400} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} placeholder="What the campaign should achieve, in a sentence or two" />
          </Field>
          <Field htmlFor="campaign-budget" label="Budget" className="col-span-2" hint="The most the campaign may spend. Spend above the approval threshold still goes to the Inbox first.">
            <MoneyInput id="campaign-budget" controlSize="md" currency={money} value={draft.budget} onValueChange={(v) => setDraft({ ...draft, budget: v })} />
          </Field>
          <Field htmlFor="campaign-starts" label="Starts">
            <Input id="campaign-starts" type="date" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
          </Field>
          <Field htmlFor="campaign-ends" label="Ends" hint="Leave empty for open-ended." error={touched && problem?.startsWith("The end date") ? problem : undefined}>
            <Input id="campaign-ends" type="date" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <InlineError error={action.error ?? (touched ? problem : null)} />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Save} onClick={() => void save()} loading={action.pending === "save"} disabled={creating && channels.length === 0}>
            {creating ? "Create campaign" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ending is final (no transitions out of Ended), so it asks first. */
export function EndCampaignDialog({ campaign, pending, onConfirm, onClose }: { campaign: CampaignRow | null; pending: boolean; onConfirm: (campaign: CampaignRow) => void; onClose: () => void }) {
  return (
    <Dialog open={!!campaign} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" data-end-campaign-dialog={campaign?.id}>
        <DialogHeader>
          <DialogTitle>End {campaign ? `“${campaign.name}”` : "this campaign"}?</DialogTitle>
          <DialogDescription>Ending is final: an ended campaign cannot be resumed or launched again. Its spend and results stay in the reports.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} autoFocus>
            Keep it running
          </Button>
          <Button variant="danger" icon={CircleStop} loading={pending} onClick={() => campaign && onConfirm(campaign)}>
            End campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
