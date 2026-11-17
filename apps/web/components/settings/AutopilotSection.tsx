"use client";
/**
 * Settings › What the team can do › Autopilot: the business starts its own cycles (business.autopilot.get / set). Off by default; an
 * owner or admin turns it on and chooses the cadence and the limits. The guard rails always win and are shown in plain
 * words: Stop all agents, used-up credits, an Inbox item that needs the founder, a vacation, the day's cycle and spend
 * limits, and failed or empty cycles in a row. Autopilot starts cycles exactly as Continue does and never approves anything.
 * The switch's help line says so in one breath (docs/UX_AUDIT_AND_PLAN.md §7.17), and the title defines the word.
 * Continue's own run (one press, cycles until nothing is left) is bound by the same daily limits, and a line says so.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AutopilotChip, Button, ErrorState, Field, Input, Label, MoneyInput, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Switch, Term } from "@foundmill/dugout";
import { AUTOPILOT_LIMITS } from "@foundmill/shared/autopilot";
import { CADENCE_OPTIONS, HOUR_OPTIONS, cyclesTodayLine, draftChanged, draftOf, parseDraft, type AutopilotDraft } from "@/lib/autopilot";
import { formatMoney } from "@/lib/format";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

type Status = RouterOutputs["business"]["autopilot"]["get"];

/** The one-line help under the switch: what Autopilot does and what it never does. */
/** Autopilot's own limits (founder, 2026-11-12: split from the ones Continue shares). */
export const AUTOPILOT_OWN_LIMITS_HINT = "These count only the rounds of work Autopilot starts on its own schedule, so they never hold back Continue. The overnight shift starts with 1 round of work and $0.15 a night.";

export const AUTOPILOT_HELP = "Autopilot presses Continue for you on a schedule. It never answers notes for you.";

/**
 * Continue and Autopilot share one set of limits (Nov 7, 2026): a press keeps the team working until nothing is left,
 * and the day's cycle and spend limits set here bound those cycles too.
 */
export const AUTOPILOT_CONTINUE_NOTE = "Continue keeps the team working, one round of work after another, until nothing is left to do. The daily limits below apply to those rounds too.";

/** The section's title, the word defined on first use; a string while it loads or fails, so nothing moves. */
const TITLE = <Term id="autopilot">Autopilot</Term>;

function SettingsForm({ businessId, status }: { businessId: string; status: Status }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const [draft, setDraft] = useState<AutopilotDraft>(() => draftOf(status.settings));
  const parsed = parseDraft(draft);
  const errors = parsed.ok ? {} : parsed.errors;
  const set = useMutation(trpc.business.autopilot.set.mutationOptions({ onSuccess: () => (void invalidate(["business"]), t.saved("Autopilot settings saved")), onError: (e) => t.failed(e) }));
  const patch = (p: Partial<AutopilotDraft>) => setDraft((d) => ({ ...d, ...p }));
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="autopilot-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.ok) set.mutate({ businessId, ...parsed.change });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field htmlFor="autopilot-cadence" label="Start the next round of work">
          <Select value={draft.cadence} onValueChange={(v) => patch({ cadence: v as AutopilotDraft["cadence"] })}>
            <SelectTrigger id="autopilot-cadence" controlSize="lg" data-testid="autopilot-cadence">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CADENCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {draft.cadence === "daily" ? (
          <Field htmlFor="autopilot-hour" label="At this hour">
            <Select value={draft.dailyHour} onValueChange={(v) => patch({ dailyHour: v })}>
              <SelectTrigger id="autopilot-hour" controlSize="lg" data-testid="autopilot-hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field htmlFor="autopilot-max-cycles" label="Most rounds of work per day" error={errors.maxCyclesPerDay} hint={`From ${AUTOPILOT_LIMITS.maxCyclesPerDay.min} to ${AUTOPILOT_LIMITS.maxCyclesPerDay.max}. Days run midnight to midnight UTC.`}>
          <Input id="autopilot-max-cycles" controlSize="lg" inputMode="numeric" value={draft.maxCyclesPerDay} onChange={(e) => patch({ maxCyclesPerDay: e.target.value })} invalid={Boolean(errors.maxCyclesPerDay)} />
        </Field>
        <Field htmlFor="autopilot-ceiling" label="Spend ceiling per day (Estimate)" error={errors.spendCeiling} hint="Model and platform spend, in US dollars. Empty means the credits you have left; it never goes past them.">
          <MoneyInput id="autopilot-ceiling" controlSize="lg" inputMode="decimal" value={draft.spendCeiling} currency="USD" onValueChange={(v) => patch({ spendCeiling: v })} invalid={Boolean(errors.spendCeiling)} placeholder="Credits left" />
        </Field>
        <Field htmlFor="autopilot-idle" label="Pause after failed or empty rounds of work" error={errors.maxIdleCycles} hint="In a row. Autopilot leaves a note in the Inbox when it pauses itself.">
          <Input id="autopilot-idle" controlSize="lg" inputMode="numeric" value={draft.maxIdleCycles} onChange={(e) => patch({ maxIdleCycles: e.target.value })} invalid={Boolean(errors.maxIdleCycles)} />
        </Field>
      </div>
      <div className="flex flex-col gap-2" data-testid="autopilot-own-limits">
        <p className="text-small-strong text-primary">Autopilot&rsquo;s own limits</p>
        <p className="text-small text-secondary">{AUTOPILOT_OWN_LIMITS_HINT}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field htmlFor="autopilot-own-cycles" label="Its own rounds of work per day" error={errors.ownMaxCyclesPerDay} hint="Empty means only the limit above.">
            <Input id="autopilot-own-cycles" controlSize="lg" inputMode="numeric" value={draft.ownMaxCyclesPerDay} onChange={(e) => patch({ ownMaxCyclesPerDay: e.target.value })} invalid={Boolean(errors.ownMaxCyclesPerDay)} placeholder="No limit of its own" data-testid="autopilot-own-cycles" />
          </Field>
          <Field htmlFor="autopilot-own-ceiling" label="Its own spend per day (Estimate)" error={errors.ownSpendCeiling} hint="In US dollars. Each round of work it starts gets what is left as its budget, so the round of work stops there too.">
            <MoneyInput id="autopilot-own-ceiling" controlSize="lg" inputMode="decimal" value={draft.ownSpendCeiling} currency="USD" onValueChange={(v) => patch({ ownSpendCeiling: v })} invalid={Boolean(errors.ownSpendCeiling)} placeholder="No limit of its own" data-testid="autopilot-own-ceiling" />
          </Field>
        </div>
      </div>
      <div>
        <Button type="submit" variant="default" loading={set.isPending} disabled={!parsed.ok || !draftChanged(draft, status.settings)} data-testid="autopilot-save">
          Save Autopilot settings
        </Button>
      </div>
    </form>
  );
}

export function AutopilotSection() {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const q = useQuery(trpc.business.autopilot.get.queryOptions({ businessId }, { staleTime: 10_000 }));
  const toggle = useMutation(
    trpc.business.autopilot.set.mutationOptions({
      onSuccess: (r) => (void invalidate(["business"]), t.saved(r.status.enabled ? "Autopilot is on" : "Autopilot is off", r.workflow && !r.workflow.queued ? `Saved; it starts when the orchestrator is back: ${r.workflow.reason ?? "unavailable"}.` : undefined)),
      onError: (e) => t.failed(e, "Autopilot not changed"),
    }),
  );
  if (q.isPending) {
    return (
      <SettingsSection title={TITLE} data-testid="autopilot-section">
        <Skeleton className="h-16 w-full" />
      </SettingsSection>
    );
  }
  if (q.error || !q.data) {
    return (
      <SettingsSection title={TITLE} data-testid="autopilot-section">
        <ErrorState onRetry={() => void q.refetch()}>Autopilot could not be loaded: {errorMessage(q.error)}</ErrorState>
      </SettingsSection>
    );
  }
  const s = q.data;
  const usd = (minor: number) => formatMoney({ amountMinor: minor, currency: "USD" });
  return (
    <SettingsSection title={TITLE} data-testid="autopilot-section">
      <div className="flex flex-col gap-3">
        <AutopilotChip state={s.state} label={s.label} detail={s.detail} nextAt={s.nextAt} />
        <p className="text-body text-secondary" data-testid="autopilot-detail">
          {s.detail}
        </p>
      </div>
      <div className="flex items-start gap-3">
        <Switch id="autopilot-switch" checked={s.enabled && s.pausedReason === null} disabled={toggle.isPending} onCheckedChange={(enabled) => toggle.mutate({ businessId, enabled })} aria-describedby="autopilot-help" data-testid="autopilot-switch" />
        <div className="flex flex-col gap-1">
          <Label htmlFor="autopilot-switch">Run this business on Autopilot</Label>
          <p id="autopilot-help" className="text-small text-secondary" data-testid="autopilot-help">
            {AUTOPILOT_HELP}
          </p>
        </div>
      </div>
      {/* A paused Autopilot stays on until the founder decides: turn it back on with the switch, or off for good here. */}
      {s.enabled && s.pausedReason !== null ? (
        <div>
          <Button type="button" variant="default" loading={toggle.isPending} onClick={() => toggle.mutate({ businessId, enabled: false })} data-testid="autopilot-turn-off">
            Turn Autopilot off
          </Button>
        </div>
      ) : null}
      <Hint>
        Off by default. When on, the next <Term id="cycle">round of work</Term> starts on its own, the way Continue starts one: every answer on this page still applies, what always comes to you still waits, and Autopilot never approves anything for you. Stop all agents stops it, and Resume does not turn it back on.
      </Hint>
      <Hint>{AUTOPILOT_CONTINUE_NOTE}</Hint>
      <dl className="grid grid-cols-3 gap-3 text-body" data-testid="autopilot-today">
        <div>
          <dt className="text-label text-secondary">Today (UTC)</dt>
          <dd className="tabular">{cyclesTodayLine(s.cyclesToday, s.settings.maxCyclesPerDay)}</dd>
        </div>
        <div>
          <dt className="text-label text-secondary">
            Spent today (<Term id="estimate" always>Estimate</Term>)
          </dt>
          <dd className="tabular">{usd(s.spentTodayMinor)}</dd>
        </div>
        <div>
          <dt className="text-label text-secondary">Credits left (Estimate)</dt>
          <dd className="tabular">{s.creditsRemainingMinor === null ? "Your own key" : usd(s.creditsRemainingMinor)}</dd>
        </div>
      </dl>
      {/* The form restarts from the saved settings after each save. */}
      <SettingsForm key={JSON.stringify(s.settings)} businessId={businessId} status={s} />
    </SettingsSection>
  );
}
