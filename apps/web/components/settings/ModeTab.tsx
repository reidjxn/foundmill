"use client";
/**
 * Settings › Mode: game mode (Live ⇄ Personal) behind a review wizard, business mode (Augmented / Assisted /
 * Automated), the spend cap per action (business.setSpendCap) and the holiday (HolidayDialog →
 * business.startHoliday / endHoliday). BUILD §9.6, §11.15. Going live asks the founder, once, to confirm that they are
 * 18 or older (BUILD §11.14: the network is for adults).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Globe, Lock, Palmtree } from "lucide-react";
import { useState } from "react";
import { BUSINESS_MODE_INFO, Button, Checkbox, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, HolidayDialog, KeyValueList, Label, MoneyInput, RadioCard, RadioGroup, StatusPill, useDateFormat, type HolidaySettings } from "@foundmill/dugout";
import { BUSINESS_MODES, type BusinessMode, type GameMode } from "@foundmill/shared/constants";
import { parseSpendCapMinor } from "@/components/new/commit/naming";
import { formatDate, formatMoney, plainWords } from "@/lib/format";
import { toStartHolidayInput } from "@/lib/holiday";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";

/** What a game-mode switch changes (BUILD §7.3, §11.14); the wizard shows it before the switch. */
export const GAME_MODE_REVIEW: Record<GameMode, string[]> = {
  live: ["Your business profile and logo become visible on the network.", "Verified metrics can rank on leaderboards; self-reported numbers never rank.", "Connections, communities and human messages open up.", "Search also shows public profiles, labeled with the product name."],
  personal: ["The business leaves search and leaderboards within 15 minutes.", "Connections and communities are hidden; nothing is deleted.", "Agents keep working exactly as before."],
};

/**
 * The business's "Spend cap per action" (first set on Commit; business.setSpendCap): above it every spend asks first,
 * whatever the mode. Empty removes the cap, and each agent's own approval threshold applies.
 */
function SpendCapForm({ businessId, capMinor, currency }: { businessId: string; capMinor: number | null; currency: string }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const [value, setValue] = useState(capMinor === null ? "" : String(capMinor / 100));
  const parsed = parseSpendCapMinor(value);
  const invalid = Number.isNaN(parsed) || (parsed !== null && parsed < 0);
  const setSpendCap = useMutation(trpc.business.setSpendCap.mutationOptions({ onSuccess: (r) => (void invalidate(["business"]), t.saved(r.spendCapMinor === null ? "Spend cap removed" : "Spend cap saved")), onError: (e) => t.failed(e) }));
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="spend-cap-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) setSpendCap.mutate({ businessId, spendCapMinor: parsed });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="settings-spend-cap" label="Spend cap per action" error={invalid ? "Use a number, like 250." : undefined} className="w-72">
          <MoneyInput id="settings-spend-cap" controlSize="lg" value={value} currency={currency} onValueChange={setValue} invalid={invalid} placeholder="No cap" />
        </Field>
        <Button type="submit" variant="default" disabled={invalid || parsed === capMinor} loading={setSpendCap.isPending}>
          Save cap
        </Button>
      </div>
      <Hint>Above this every spend asks you first, whatever the mode; below it each agent&apos;s own approval threshold applies. Empty means no cap. Money movement, signatures and identity always ask.</Hint>
    </form>
  );
}

export function ModeTab() {
  const datePrefs = useDateFormat();
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const b = data.business;
  const [reviewTarget, setReviewTarget] = useState<GameMode | null>(null);
  const [holidayOpen, setHolidayOpen] = useState(false);
  // Going live asks for the founder's 18+ confirmation unless it is already on record (`live.summary`, the shell's badge query).
  const [adult, setAdult] = useState(false);
  const summaryQ = useQuery(trpc.live.summary.queryOptions(undefined, { staleTime: 10_000, retry: false }));
  const needsAdult = reviewTarget === "live" && summaryQ.data?.adultConfirmed !== true;
  const closeReview = () => (setReviewTarget(null), setAdult(false));

  const setGameMode = useMutation(trpc.business.setGameMode.mutationOptions({ onSuccess: (_r, v) => (void invalidate(["business", "live"]), closeReview(), t.saved(v.gameMode === "live" ? "The business is live" : "The business is personal again")), onError: (e) => t.failed(e) }));
  const setBusinessMode = useMutation(trpc.business.setBusinessMode.mutationOptions({ onSuccess: () => (void invalidate(["business"]), t.saved("Business mode changed")), onError: (e) => t.failed(e) }));
  const startHoliday = useMutation(trpc.business.startHoliday.mutationOptions({ onSuccess: (r) => (void invalidate(["business", "inbox"]), setHolidayOpen(false), t.saved("Vacation started", r.workflow.queued ? "The Chief of Staff is in charge." : `Recorded; the workflow is not running: ${r.workflow.reason ?? "orchestrator unavailable"}.`)), onError: (e) => t.failed(e) }));
  const endHoliday = useMutation(trpc.business.endHoliday.mutationOptions({ onSuccess: () => (void invalidate(["business", "inbox"]), t.saved("Welcome back")), onError: (e) => t.failed(e) }));

  const holiday = data.holiday;
  const currency = useBusinessCurrency();

  return (
    <AdminOnly>
      <SettingsSection title="Personal or live">
        <div className="flex items-center gap-3">
          <StatusPill tone={b.gameMode === "live" ? "info" : "neutral"} icon={b.gameMode === "live" ? Globe : Lock}>
            {b.gameMode === "live" ? "Live" : "Personal"}
          </StatusPill>
          <p className="text-body text-secondary">{b.gameMode === "live" ? "Visible on the network and eligible for leaderboards." : "Private: only members of this business can see it."}</p>
        </div>
        <div>
          <Button variant="default" onClick={() => setReviewTarget(b.gameMode === "live" ? "personal" : "live")} data-testid="switch-game-mode">
            {b.gameMode === "live" ? "Switch to Personal" : "Go live"}
          </Button>
        </div>
        <Dialog open={reviewTarget !== null} onOpenChange={(o) => !o && closeReview()}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{reviewTarget === "live" ? "Review before going live" : "Review before switching to Personal"}</DialogTitle>
              <DialogDescription>This is what changes. Nothing is deleted either way.</DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-3">
              <ul className="flex list-disc flex-col gap-1 pl-5 text-body">{(reviewTarget ? GAME_MODE_REVIEW[reviewTarget] : []).map((line) => <li key={line}>{line}</li>)}</ul>
              {needsAdult ? (
                <div className="flex items-start gap-2" data-testid="go-live-adult">
                  <Checkbox id="go-live-adult" checked={adult} onCheckedChange={(v) => setAdult(v === true)} className="mt-0.5" />
                  <Label htmlFor="go-live-adult" className="normal-case tracking-normal text-body text-primary">
                    I am 18 or older. The network is for adults; you confirm this once.
                  </Label>
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={closeReview}>
                Cancel
              </Button>
              <Button variant="primary" disabled={needsAdult && !adult} loading={setGameMode.isPending} onClick={() => reviewTarget && setGameMode.mutate({ businessId, gameMode: reviewTarget, reason: "settings", ...(needsAdult ? { confirmAdult: true } : {}) })}>
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SettingsSection>

      <SettingsSection title="Business mode">
        <RadioGroup value={b.businessMode} onValueChange={(v) => setBusinessMode.mutate({ businessId, businessMode: v as BusinessMode, reason: "settings" })} aria-label="Business mode" className="grid grid-cols-3 gap-2" disabled={setBusinessMode.isPending}>
          {BUSINESS_MODES.map((m) => (
            <RadioCard key={m} id={`mode-${m}`} value={m} label={BUSINESS_MODE_INFO[m].word} description={BUSINESS_MODE_INFO[m].summary} />
          ))}
        </RadioGroup>
        <Hint>Hard gates (money, signatures, filings, legal terms, permanent deletion, security settings, acting on untrusted content) always need you, whatever the mode.</Hint>
      </SettingsSection>

      <SettingsSection title="Spend cap per action">
        <SpendCapForm key={b.spendCapMinor ?? "none"} businessId={businessId} capMinor={b.spendCapMinor} currency={currency} />
      </SettingsSection>

      <SettingsSection title="Vacation">
        {holiday ? (
          <div className="flex flex-col gap-3" data-testid="holiday-active">
            <StatusPill tone="info" icon={Palmtree}>
              On vacation
            </StatusPill>
            <KeyValueList
              items={[
                { label: "Until", value: holiday.untilAt ? formatDate(holiday.untilAt, datePrefs) : ((holiday.untilCondition as { text?: string } | null)?.text ?? "until I return") },
                { label: "Budget ceiling", value: holiday.budgetCeilingMinor === null ? "Business cap applies" : formatMoney({ amountMinor: holiday.budgetCeilingMinor, currency: holiday.currency ?? currency }), numeric: true },
                { label: "Authority", value: <span className="flex flex-wrap gap-1">{((holiday.authority as { decisionTypes?: string[] } | null)?.decisionTypes ?? []).map((d) => <Chip key={d}>{plainWords(d)}</Chip>)}</span> },
              ]}
            />
            <div>
              <Button variant="primary" loading={endHoliday.isPending} onClick={() => endHoliday.mutate({ businessId, reason: "founder_returned" })}>
                Come back
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-body text-secondary">Hand the business to the Chief of Staff: cycles run on their own, decisions within the authority you set, gated items queue in the Inbox.</p>
            <div>
              <Button variant="default" icon={Palmtree} onClick={() => setHolidayOpen(true)} data-testid="start-holiday">
                Go on vacation
              </Button>
            </div>
          </div>
        )}
        <HolidayDialog open={holidayOpen} onOpenChange={setHolidayOpen} currency={currency} onSubmit={(settings: HolidaySettings) => startHoliday.mutateAsync({ businessId, ...toStartHolidayInput(settings, currency) }).then(() => undefined)} />
      </SettingsSection>
    </AdminOnly>
  );
}
