"use client";
/**
 * Settings › Mode: game mode (LIVE ⇄ Personal) behind a review wizard, business mode (Augmented / Assisted /
 * Automated) and the holiday (HolidayDialog → business.startHoliday / endHoliday). BUILD §9.6, §11.15.
 */
import { useMutation } from "@tanstack/react-query";
import { Palmtree, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { BUSINESS_MODE_INFO, Button, Chip, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, HolidayDialog, KeyValueList, RadioGroup, RadioOption, StatusPill, type HolidaySettings } from "@foundmill/dugout";
import { BUSINESS_MODES, type BusinessMode, type GameMode } from "@foundmill/shared";
import { formatDate } from "@/lib/format";
import { toStartHolidayInput } from "@/lib/holiday";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";

/** What a game-mode switch changes (BUILD §7.3, §11.14); the wizard shows it before the switch. */
export const GAME_MODE_REVIEW: Record<GameMode, string[]> = {
  live: ["Your business profile and logo become visible on the network.", "Verified metrics can rank on leaderboards; self-reported numbers never rank.", "Connections, communities and human messages open up.", "Search also shows public profiles, labelled with the product name."],
  personal: ["The business leaves search and leaderboards within 15 minutes.", "Connections and communities are hidden; nothing is deleted.", "Agents keep working exactly as before."],
};

export function ModeTab() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const b = data.business;
  const [reviewTarget, setReviewTarget] = useState<GameMode | null>(null);
  const [holidayOpen, setHolidayOpen] = useState(false);

  const setGameMode = useMutation(trpc.business.setGameMode.mutationOptions({ onSuccess: () => (void invalidate(["business", "live"]), setReviewTarget(null), t.saved("Game mode changed")), onError: (e) => t.failed(e) }));
  const setBusinessMode = useMutation(trpc.business.setBusinessMode.mutationOptions({ onSuccess: () => (void invalidate(["business"]), t.saved("Business mode changed")), onError: (e) => t.failed(e) }));
  const startHoliday = useMutation(trpc.business.startHoliday.mutationOptions({ onSuccess: (r) => (void invalidate(["business", "inbox"]), setHolidayOpen(false), t.saved("Holiday started", r.workflow.queued ? "The Chief of Staff is in charge." : `Recorded; the workflow is not running: ${r.workflow.reason ?? "orchestrator unavailable"}.`)), onError: (e) => t.failed(e) }));
  const endHoliday = useMutation(trpc.business.endHoliday.mutationOptions({ onSuccess: () => (void invalidate(["business", "inbox"]), t.saved("Welcome back")), onError: (e) => t.failed(e) }));

  const holiday = data.holiday;

  return (
    <AdminOnly>
      <SettingsSection title="Game mode">
        <div className="flex items-center gap-3">
          <StatusPill tone={b.gameMode === "live" ? "info" : "neutral"} icon={ShieldCheck}>
            {b.gameMode === "live" ? "LIVE" : "Personal"}
          </StatusPill>
          <p className="text-body text-secondary">{b.gameMode === "live" ? "Visible on the network and eligible for leaderboards." : "Private: only members of this business can see it."}</p>
        </div>
        <div>
          <Button variant="default" onClick={() => setReviewTarget(b.gameMode === "live" ? "personal" : "live")} data-testid="switch-game-mode">
            {b.gameMode === "live" ? "Switch to Personal" : "Go LIVE"}
          </Button>
        </div>
        <Dialog open={reviewTarget !== null} onOpenChange={(o) => !o && setReviewTarget(null)}>
          <DialogContent size="md">
            <DialogHeader>
              <DialogTitle>{reviewTarget === "live" ? "Review before going LIVE" : "Review before switching to Personal"}</DialogTitle>
              <DialogDescription>This is what changes. Nothing is deleted either way.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-body">{(reviewTarget ? GAME_MODE_REVIEW[reviewTarget] : []).map((line) => <li key={line}>{line}</li>)}</ul>
              <Hint>The full review wizard (identity verification, field-level visibility) arrives with the LIVE build; this step records the switch.</Hint>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setReviewTarget(null)}>
                Cancel
              </Button>
              <Button variant="primary" loading={setGameMode.isPending} onClick={() => reviewTarget && setGameMode.mutate({ businessId, gameMode: reviewTarget, reason: "settings" })}>
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SettingsSection>

      <SettingsSection title="Business mode">
        <RadioGroup value={b.businessMode} onValueChange={(v) => setBusinessMode.mutate({ businessId, businessMode: v as BusinessMode, reason: "settings" })} aria-label="Business mode" className="flex flex-col gap-2">
          {BUSINESS_MODES.map((m) => (
            <RadioOption key={m} id={`mode-${m}`} value={m} label={BUSINESS_MODE_INFO[m].word} description={BUSINESS_MODE_INFO[m].summary} disabled={setBusinessMode.isPending} />
          ))}
        </RadioGroup>
        <Hint>Hard gates (money, signatures, filings, legal terms, permanent deletion, security settings, acting on untrusted content) always need you, whatever the mode.</Hint>
      </SettingsSection>

      <SettingsSection title="Holiday">
        {holiday ? (
          <div className="flex flex-col gap-3" data-testid="holiday-active">
            <StatusPill tone="info" icon={Palmtree}>
              On holiday
            </StatusPill>
            <KeyValueList
              items={[
                { label: "Until", value: holiday.untilAt ? formatDate(holiday.untilAt) : ((holiday.untilCondition as { text?: string } | null)?.text ?? "until I return") },
                { label: "Budget ceiling", value: holiday.budgetCeilingMinor === null ? "Business cap applies" : `${(holiday.budgetCeilingMinor / 100).toFixed(2)} ${holiday.currency ?? ""}`, numeric: true },
                { label: "Authority", value: <span className="flex flex-wrap gap-1">{((holiday.authority as { decisionTypes?: string[] } | null)?.decisionTypes ?? []).map((d) => <Chip key={d}>{d.replace(/_/g, " ")}</Chip>)}</span> },
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
                Go on holiday
              </Button>
            </div>
          </div>
        )}
        <HolidayDialog open={holidayOpen} onOpenChange={setHolidayOpen} currency="EUR" onSubmit={(settings: HolidaySettings) => startHoliday.mutateAsync({ businessId, ...toStartHolidayInput(settings) }).then(() => undefined)} />
      </SettingsSection>
    </AdminOnly>
  );
}
