"use client";
/**
 * Settings › Mode: game mode (Live ⇄ Personal) behind a review wizard, business mode (Augmented / Assisted /
 * Automated), Autopilot (business.autopilot.*), the spend cap per action (business.setSpendCap) and the holiday (HolidayDialog →
 * business.startHoliday / endHoliday). BUILD §9.6, §11.15. Going live asks the founder, once, to confirm that they are
 * 18 or older (BUILD §11.14: the network is for adults).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Globe, Lock, Palmtree } from "lucide-react";
import { useEffect, useState } from "react";
import { BUSINESS_MODE_INFO, Button, Checkbox, Chip, ConsequenceLine, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, HolidayDialog, KeyValueList, Label, MoneyInput, RadioCard, RadioGroup, StatusPill, Term, useFormatters, type HolidaySettings } from "@foundmill/dugout";
import { BUSINESS_MODES, type BusinessMode, type GameMode } from "@foundmill/shared/constants";
import { vacationUntilLabel } from "@foundmill/shared";
import { BUSINESS_MODE_CARDS, parseSpendCapMinor } from "@/components/new/commit/naming";
import { formatMoney, plainWords } from "@/lib/format";
import { toStartHolidayInput } from "@/lib/holiday";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import { AutopilotSection } from "./AutopilotSection";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";

/** What a game-mode switch changes (BUILD §7.3, §11.14); the wizard shows it before the switch. */
export const GAME_MODE_REVIEW: Record<GameMode, string[]> = {
  live: ["Your business profile and logo become visible on the network.", "Verified metrics can rank on leaderboards; self-reported numbers never rank.", "Connections, communities and human messages open up.", "Search also shows public profiles, labeled with the product name.", "The network is for people 18 or older: you confirm that before going live."],
  personal: ["The business leaves search and leaderboards within 15 minutes.", "Connections and communities are hidden; nothing is deleted.", "Agents keep working exactly as before."],
};

/** The consequence line under the game-mode button: what the switch to `target` does, and that it can be undone. */
export const GAME_MODE_CONSEQUENCE: Record<GameMode, { consequence: string; reversible: true }> = {
  live: { consequence: "Your profile and logo become visible on the network; switch back to Personal any time.", reversible: true },
  personal: { consequence: "The business leaves search and leaderboards within 15 minutes; nothing is deleted.", reversible: true },
};

/** The consequence line under Go on vacation (docs/UX_AUDIT_AND_PLAN.md §6.2 names Vacation among the actions that carry one). */
export const VACATION_CONSEQUENCE = { consequence: "The Chief of Staff decides inside the authority you set; hard gates still wait for you. Come back ends it.", reversible: true } as const;

/** One concrete day in a business mode, from the Commit cards ("Example: drafts the pricing page and publishes it; asks before paying for a domain."). */
export function businessModeExample(mode: BusinessMode): string | undefined {
  return BUSINESS_MODE_CARDS.find((c) => c.value === mode)?.example;
}

/**
 * The business's "Spend cap per action" (first set on Commit; business.setSpendCap): above it every spend asks first,
 * whatever the mode. Empty removes the cap, and each agent's own approval threshold applies.
 */
function SpendCapForm({ businessId, capMinor, currency }: { businessId: string; capMinor: number | null; currency: string }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const [value, setValue] = useState(capMinor === null ? "" : String(capMinor / 100));
  // The saved cap changing (this save, or another tab's) updates the field in place: a remount would drop the keyboard
  // focus the Save button keeps while it saves.
  useEffect(() => setValue(capMinor === null ? "" : String(capMinor / 100)), [capMinor]);
  const parsed = parseSpendCapMinor(value);
  const invalid = Number.isNaN(parsed) || (parsed !== null && parsed < 0);
  const setSpendCap = useMutation(trpc.business.setSpendCap.mutationOptions({ onSuccess: (r) => (void invalidate(["business"]), t.saved(r.spendCapMinor === null ? "Spend cap removed" : "Spend cap saved")), onError: (e) => t.failed(e) }));
  // Nothing to save (unchanged or not a number) turns Save off with aria-disabled, not `disabled`: a save that succeeds
  // leaves the cap unchanged while the button still has keyboard focus, and a disabled button would drop it to <body>.
  const unchanged = invalid || parsed === capMinor;
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="spend-cap-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!unchanged && !setSpendCap.isPending) setSpendCap.mutate({ businessId, spendCapMinor: parsed });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field htmlFor="settings-spend-cap" label="Spend cap per action" error={invalid ? "Use a number, like 250." : undefined} className="w-72">
          <MoneyInput id="settings-spend-cap" controlSize="lg" value={value} currency={currency} onValueChange={setValue} invalid={invalid} placeholder="No cap" />
        </Field>
        <Button type="submit" variant="default" aria-disabled={unchanged || undefined} loading={setSpendCap.isPending} data-testid="spend-cap-save">
          Save cap
        </Button>
      </div>
      <Hint>Above this every spend asks you first, whatever the mode; below it each agent&apos;s own approval threshold applies. Empty means no cap. Money movement, signatures and identity always ask.</Hint>
    </form>
  );
}

export function ModeTab() {
  // The vacation's end prints in the founder's own zone, like the top bar's caption (audit OL-06).
  const { formatDate: formatLocalDate } = useFormatters();
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
        {data.liveOpen ? (
          <div className="flex flex-col gap-1.5">
            <div>
              <Button variant="default" onClick={() => setReviewTarget(b.gameMode === "live" ? "personal" : "live")} data-testid="switch-game-mode">
                {b.gameMode === "live" ? "Switch to Personal" : "Go live"}
              </Button>
            </div>
            <ConsequenceLine {...GAME_MODE_CONSEQUENCE[b.gameMode === "live" ? "personal" : "live"]} data-testid="game-mode-consequence" />
          </div>
        ) : (
          <p className="text-body text-secondary" data-testid="live-closed-note">Live is not open yet. When it opens, you can list this business on the network from here.</p>
        )}
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

      <SettingsSection title={<Term id="business_mode">Business mode</Term>}>
        <RadioGroup value={b.businessMode} onValueChange={(v) => setBusinessMode.mutate({ businessId, businessMode: v as BusinessMode, reason: "settings" })} aria-label="Business mode" className="grid grid-cols-3 gap-2" disabled={setBusinessMode.isPending}>
          {BUSINESS_MODES.map((m) => {
            const example = businessModeExample(m);
            return (
              <RadioCard
                key={m}
                id={`mode-${m}`}
                value={m}
                label={BUSINESS_MODE_INFO[m].word}
                description={
                  <>
                    <span>{BUSINESS_MODE_INFO[m].summary}</span>
                    {/* One concrete day in the mode, the line the Commit cards carry: the business thing, then the example. */}
                    {example ? (
                      <span className="mt-1 block border-t border-line-faint pt-1.5" data-mode-example="">
                        {example}
                      </span>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </RadioGroup>
        {holiday ? (
          // The mode in force while away is Automated (BUILD §9.6); the choice above is the one that comes back.
          <p className="flex items-center gap-2 text-body text-secondary" data-testid="mode-in-force">
            <StatusPill tone="info" icon={Palmtree}>
              Automated while on vacation
            </StatusPill>
            {b.businessMode === "automated" ? null : <span>{BUSINESS_MODE_INFO[b.businessMode].word} again when you come back.</span>}
          </p>
        ) : null}
        <Hint>
          <Term id="hard_gate">Hard gates</Term> (money, signatures, filings, legal terms, permanent deletion, security settings, acting on untrusted content) always need you, whatever the mode.
        </Hint>
      </SettingsSection>

      <AutopilotSection />

      <SettingsSection title="Spend cap per action">
        <SpendCapForm businessId={businessId} capMinor={b.spendCapMinor} currency={currency} />
      </SettingsSection>

      <SettingsSection title={<Term id="vacation">Vacation</Term>}>
        {holiday ? (
          <div className="flex flex-col gap-3" data-testid="holiday-active">
            <StatusPill tone="info" icon={Palmtree}>
              On vacation
            </StatusPill>
            <KeyValueList
              items={[
                { label: "Until", value: holiday.untilAt ? formatLocalDate(holiday.untilAt) : vacationUntilLabel((holiday.untilCondition as { text?: string } | null)?.text) },
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
            <p className="text-body text-secondary">
              Hand the business to the <Term id="chief_of_staff">Chief of Staff</Term>: <Term id="cycle">cycles</Term> run on their own, decisions within the authority you set, gated items queue in the Inbox.
            </p>
            <div className="flex flex-col gap-1.5">
              <div>
                <Button variant="default" icon={Palmtree} onClick={() => setHolidayOpen(true)} data-testid="start-holiday">
                  Go on vacation
                </Button>
              </div>
              <ConsequenceLine {...VACATION_CONSEQUENCE} data-testid="vacation-consequence" />
            </div>
          </div>
        )}
        <HolidayDialog open={holidayOpen} onOpenChange={setHolidayOpen} currency={currency} onSubmit={(settings: HolidaySettings) => startHoliday.mutateAsync({ businessId, ...toStartHolidayInput(settings, currency) }).then(() => undefined)} />
      </SettingsSection>
    </AdminOnly>
  );
}
