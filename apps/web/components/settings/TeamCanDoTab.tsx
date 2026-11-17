"use client";
/**
 * Settings › What the team can do (slug `mode`; founder, 2026-11-07): one page for how much the team does before it
 * checks with the founder. It re-presents settings that already exist and changes nothing they enforce:
 *
 * 1. How much the team does before checking with you: the business mode (`business.setBusinessMode`), in plain answers.
 * 2. The amount above which every purchase asks: the spend line (`business.setSpendCap`): an amount, always ask (0), or
 *    each agent's own limit (null), named with the real default so it never reads as "no limit".
 * 3. Who answers when the team asks about publishing and messaging customers: you or the Chief of Staff, written to
 *    every department's approvers (`team.responsibilities.set`); read-only when departments disagree.
 * 4. Putting changes live and adding agents or changing models: what happens today, said as statements, not choices.
 * 5. When the team stops (read-only, item 10): the situations in which the loop of work stops and asks, or stops on
 *    its own, for the answer in force (`loopStops`).
 * 6. Autopilot (`AutopilotSection`) and the vacation (HolidayDialog → business.startHoliday / endHoliday).
 *
 * What always comes to the founder is said once, at the top. The words are @foundmill/shared `team-can-do.ts`, held to
 * the Cedar policies by packages/policy's `team-can-do.test.ts`. Personal or live moved to Settings › Business. BUILD
 * §9.6, §11.15.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Palmtree, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Chip, ConsequenceLine, Field, HolidayDialog, Icon, KeyValueList, Label, MoneyInput, RadioCard, RadioGroup, RadioOption, ShellLink, Skeleton, StatusPill, Switch, Term, useFormatters, type HolidaySettings } from "@foundmill/dugout";
import type { BusinessMode, DecisionType } from "@foundmill/shared/constants";
import { vacationUntilLabel } from "@foundmill/shared";
import { LOOP_STOPS_INTRO, LOOP_STOPS_TITLE, loopStops } from "@foundmill/shared/loop-stops";
import {
  TEAM_CAN_DO_AGENTS_STATEMENT, TEAM_CAN_DO_ALWAYS_YOURS, TEAM_CAN_DO_OPTIONS, TEAM_CAN_DO_QUESTION, agentsWithOwnSettingLine, eachAgentLimitLabel, recommendedSpendLineMinor, spendAmountWords, spendLineSoonerNote,
  teamCanDoOptionDescription,
} from "@foundmill/shared/team-can-do";
import { routes } from "@foundmill/widgets/shared/routes";
import { BUSINESS_MODE_CARDS } from "@/components/new/commit/naming";
import { formatMoney, plainWords } from "@/lib/format";
import { toStartHolidayInput } from "@/lib/holiday";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import { AutopilotSection } from "./AutopilotSection";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SettingsSection, useSettingsToast } from "./shared";
import { AGENT_LIMIT_MINOR, DELEGABLE, amountField, answerHandler, answerState, hasOwnAnswer, parseSpendLineDraft, spendLineDraftOf, spendLineSavedTitle, type AnswerValue, type SpendLineDraft } from "./team-can-do-logic";

/** The consequence line under Go on vacation (docs/UX_AUDIT_AND_PLAN.md §6.2 names Vacation among the actions that carry one). */
export const VACATION_CONSEQUENCE = { consequence: "The Chief of Staff decides inside the authority you set; what always comes to you still waits. Come back ends it.", reversible: true } as const;

/** One concrete day under each answer, from the Commit cards ("Example: drafts the pricing page and publishes it; …"). */
export function businessModeExample(mode: BusinessMode): string | undefined {
  return BUSINESS_MODE_CARDS.find((c) => c.value === mode)?.example;
}

/** The spend line's question: the amount is an upper bound, so the question asks for the point where asking starts. */
export const SPEND_LINE_QUESTION = "Above what amount should a purchase always ask you first?";

/** Question 2: an amount, always ask, or each agent's own limit (`business.setSpendCap`). */
function SpendLineForm({ businessId, lineMinor, currency, mode }: { businessId: string; lineMinor: number | null; currency: string; mode: BusinessMode }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const suggestion = recommendedSpendLineMinor(mode, AGENT_LIMIT_MINOR);
  const [draft, setDraft] = useState<SpendLineDraft>(() => spendLineDraftOf(lineMinor, currency, suggestion));
  // The saved line changing (this save, or another tab's) updates the form in place: a remount would drop the keyboard
  // focus the Save button keeps while it saves.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the saved value only
  useEffect(() => setDraft(spendLineDraftOf(lineMinor, currency, suggestion)), [lineMinor, currency]);
  const parsed = parseSpendLineDraft(draft, currency);
  const setSpendCap = useMutation(trpc.business.setSpendCap.mutationOptions({ onSuccess: (r) => (void invalidate(["business"]), t.saved(spendLineSavedTitle(r.spendCapMinor))), onError: (e) => t.failed(e) }));
  // Nothing to save turns Save off with aria-disabled, not `disabled`: a save that succeeds leaves the line unchanged
  // while the button still has keyboard focus, and a disabled button would drop it to <body>.
  const unchanged = !parsed.ok || parsed.minor === lineMinor;
  const sooner = parsed.ok ? spendLineSoonerNote({ lineMinor: parsed.minor, currency, agentLimitMinor: AGENT_LIMIT_MINOR }) : null;
  return (
    <form
      className="flex flex-col gap-3"
      data-testid="spend-cap-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!unchanged && parsed.ok && !setSpendCap.isPending) setSpendCap.mutate({ businessId, spendCapMinor: parsed.minor });
      }}
    >
      <RadioGroup value={draft.kind} onValueChange={(v) => setDraft((d) => ({ ...d, kind: v as SpendLineDraft["kind"] }))} aria-label={SPEND_LINE_QUESTION} className="flex flex-col gap-2.5">
        <RadioOption id="spend-line-amount" value="amount" label="An amount" />
        <div className="flex flex-wrap items-end gap-3 pl-6">
          <Field htmlFor="settings-spend-line" label="Amount per purchase" error={!parsed.ok && draft.kind === "amount" ? parsed.error : undefined} className="w-72">
            <MoneyInput id="settings-spend-line" controlSize="lg" value={draft.amount} currency={currency} onValueChange={(amount) => setDraft({ kind: "amount", amount })} invalid={!parsed.ok && draft.kind === "amount"} placeholder={suggestion > 0 ? amountField(suggestion, currency) : amountField(AGENT_LIMIT_MINOR, currency)} />
          </Field>
        </div>
        <RadioOption id="spend-line-always" value="always" label="Always ask" description="Every purchase asks you first, whatever it costs." />
        <RadioOption id="spend-line-agent" value="agent" label={eachAgentLimitLabel({ currency, agentLimitMinor: AGENT_LIMIT_MINOR })} description="Each agent asks above its own limit, set on its Autonomy tab." />
      </RadioGroup>
      {mode === "augmented" ? <Hint>With your first answer every purchase asks you anyway. This amount applies on vacation and if you change that answer.</Hint> : null}
      {sooner ? <Hint>{sooner}</Hint> : null}
      {suggestion > 0 ? <Hint>Suggested for your first answer: {spendAmountWords(suggestion, currency)}.</Hint> : null}
      <div>
        <Button type="submit" variant="default" aria-disabled={unchanged || undefined} loading={setSpendCap.isPending} data-testid="spend-cap-save">
          Save
        </Button>
      </div>
    </form>
  );
}

/** One row of "Who answers": the decision on the left, the answer (or a statement) on the right. */
function AnswerRow({ label, hint, children, testId }: { label: string; hint?: ReactNode; children: ReactNode; testId: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start gap-4 border-t border-line-faint pt-3 first:border-t-0 first:pt-0" data-testid={testId}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-body-strong">{label}</span>
        {hint ? <span className="text-small text-secondary">{hint}</span> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Rows 3 to 6: who answers publishing and messaging, and what happens today for releases, hiring and models. */
function WhoAnswers({ businessId, mode, responsibilitiesHref }: { businessId: string; mode: BusinessMode; responsibilitiesHref: string }) {
  const trpc = useTRPC();
  const t = useSettingsToast();
  const respQ = useQuery(trpc.team.responsibilities.get.queryOptions({ businessId }, { staleTime: 10_000 }));
  const agentsQ = useQuery(trpc.team.agents.list.queryOptions({ businessId }, { staleTime: 60_000 }));
  const setResponsibility = useMutation(trpc.team.responsibilities.set.mutationOptions({ onSuccess: () => (void respQ.refetch(), t.saved("Saved")), onError: (e) => t.failed(e) }));
  const chiefId = respQ.data?.chiefOfStaffId ?? null;
  const own = useMemo(() => (agentsQ.data?.agents ?? []).filter((a) => !a.archivedAt && hasOwnAnswer(a.autonomy, mode)), [agentsQ.data, mode]);
  const ownLine = agentsWithOwnSettingLine(own.length);

  return (
    <SettingsSection title="Who answers when the team asks" data-testid="team-can-do-answers">
      {respQ.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="flex flex-col gap-3">
          {DELEGABLE.map(({ decisionType, label, hint }) => (
            <AnswerRow key={decisionType} label={label} hint={hint} testId={`answer-${decisionType}`}>
              <Answer decisionType={decisionType} label={label} rows={respQ.data?.matrix} chiefId={chiefId} pending={setResponsibility.isPending} onChange={(value) => chiefId && setResponsibility.mutate({ businessId, decisionType, handler: answerHandler(value, chiefId) })} responsibilitiesHref={responsibilitiesHref} />
              {mode === "automated" ? <p className="mt-1.5 text-small text-secondary">With your first answer the team rarely asks about this.</p> : null}
            </AnswerRow>
          ))}
          <AnswerRow label="Putting changes live in your product" testId="answer-merge_to_main">
            <p className="text-body">Always asks you.</p>
            <ShellLink href={responsibilitiesHref} className="text-small">
              Let a staff member decide
            </ShellLink>
          </AnswerRow>
          <AnswerRow label="Adding agents or changing an agent's model" testId="answer-agents">
            <p className="text-body">{TEAM_CAN_DO_AGENTS_STATEMENT}</p>
          </AnswerRow>
        </div>
      )}
      <Hint>
        When the <Term id="chief_of_staff">Chief of Staff</Term> is the one asking, the question still comes to you. To hand one decision to a staff member or one department, use <ShellLink href={responsibilitiesHref}>Team › Responsibilities</ShellLink>; your <Term id="playbook">playbooks</Term> are there too, each with its own approvals.
      </Hint>
      {ownLine ? (
        <p className="text-small text-secondary" data-testid="agents-own-setting">
          {ownLine}{" "}
          {own.map((a, i) => (
            <span key={a.id}>
              {i > 0 ? ", " : ""}
              <ShellLink href={routes.agent(businessId, a.id, "autonomy")}>{a.name}</ShellLink>
            </span>
          ))}
        </p>
      ) : null}
    </SettingsSection>
  );
}

/**
 * When the team stops (item 10, Nov 13, 2026): read-only, the situations in which the loop of work stops for this
 * project, for the answer in force (on vacation, the third answer's) and its spend line (@foundmill/shared
 * `loopStops`, held to Cedar by packages/policy `loop-stops.test.ts`). No controls: each line is changed where it lives.
 */
function WhenTheTeamStops({ businessId, mode, line, holiday }: { businessId: string; mode: BusinessMode; line: { lineMinor: number | null; currency: string; agentLimitMinor: number }; holiday: boolean }) {
  const trpc = useTRPC();
  const autopilotQ = useQuery(trpc.business.autopilot.get.queryOptions({ businessId }, { staleTime: 10_000 }));
  const a = autopilotQ.data;
  const list = loopStops({ ...line, mode, holiday, autopilot: a ? { enabled: a.enabled, maxIdleCycles: a.settings.maxIdleCycles } : null });
  return (
    <SettingsSection title={LOOP_STOPS_TITLE} data-testid="team-can-do-stops">
      <p className="text-body text-secondary">{LOOP_STOPS_INTRO}</p>
      <div className="flex flex-col gap-3" data-testid="stops-asks">
        <span className="text-body-strong">It stops and asks you first</span>
        {list.asks.map((s) => (
          <AnswerRow key={s.id} label={s.when} testId={`stop-${s.id}`}>
            <p className="text-body">{s.then}</p>
          </AnswerRow>
        ))}
      </div>
      <div className="flex flex-col gap-3" data-testid="stops-own">
        <span className="text-body-strong">It stops on its own, without asking</span>
        {list.stops.map((s) => (
          <AnswerRow key={s.id} label={s.when} testId={`stop-${s.id}`}>
            <p className="text-body">{s.then}</p>
          </AnswerRow>
        ))}
      </div>
      {holiday ? <Hint>On vacation the team works as with your third answer, so this list is that answer&apos;s. Your own answer comes back with you.</Hint> : null}
    </SettingsSection>
  );
}

function Answer({ decisionType, label, rows, chiefId, pending, onChange, responsibilitiesHref }: { decisionType: DecisionType; label: string; rows: Parameters<typeof answerState>[0]; chiefId: string | null; pending: boolean; onChange: (v: AnswerValue) => void; responsibilitiesHref: string }) {
  const state = answerState(rows, decisionType, chiefId);
  if (state.kind === "elsewhere") {
    return (
      <p className="text-body text-secondary" data-answer="elsewhere">
        {state.reason === "differs" ? "Differs by department" : "Someone else answers"}: open <ShellLink href={responsibilitiesHref}>Team › Responsibilities</ShellLink>.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <RadioGroup value={state.value} onValueChange={(v) => onChange(v as AnswerValue)} aria-label={label} className="flex flex-wrap gap-x-5 gap-y-2" disabled={pending}>
        <RadioOption id={`${decisionType}-founder`} value="founder" label="Ask me" />
        <RadioOption id={`${decisionType}-chief`} value="chief" label="The Chief of Staff approves" disabled={!chiefId} />
      </RadioGroup>
      {!chiefId ? <span className="text-small text-secondary">The Chief of Staff joins with the business; until then you answer.</span> : null}
    </div>
  );
}

export function TeamCanDoTab() {
  // The vacation's end prints in the founder's own zone, like the top bar's caption (audit OL-06).
  const { formatDate: formatLocalDate } = useFormatters();
  const { businessId, data, departments } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const b = data.business;
  const [holidayOpen, setHolidayOpen] = useState(false);
  const setBusinessMode = useMutation(trpc.business.setBusinessMode.mutationOptions({ onSuccess: () => (void invalidate(["business"]), t.saved("Saved", "The top bar says what the team can do now.")), onError: (e) => t.failed(e) }));
  const startHoliday = useMutation(trpc.business.startHoliday.mutationOptions({ onSuccess: (r) => (void invalidate(["business", "inbox"]), setHolidayOpen(false), t.saved("Vacation started", r.workflow.queued ? "The Chief of Staff is in charge." : `Recorded; the workflow is not running: ${r.workflow.reason ?? "orchestrator unavailable"}.`)), onError: (e) => t.failed(e) }));
  const setPaymentPowers = useMutation(trpc.business.setPaymentPowers.mutationOptions({ onSuccess: () => (void invalidate(["business"]), t.saved("Saved")), onError: (e) => t.failed(e) }));
  const endHoliday = useMutation(trpc.business.endHoliday.mutationOptions({ onSuccess: () => (void invalidate(["business", "inbox"]), t.saved("Welcome back")), onError: (e) => t.failed(e) }));

  const holiday = data.holiday;
  const currency = useBusinessCurrency();
  const line = { lineMinor: b.spendCapMinor, currency, agentLimitMinor: AGENT_LIMIT_MINOR };
  const team = departments.find((d) => d.moduleKeys.includes("team"));
  const responsibilitiesHref = routes.department(businessId, team?.slug ?? "team", "responsibilities");

  return (
    <AdminOnly>
      <SettingsSection title={TEAM_CAN_DO_QUESTION} data-testid="team-can-do-mode">
        {/* Said once, here: no answer on this page changes it. */}
        <p className="flex items-start gap-2 text-body" data-testid="team-can-do-always">
          <Icon icon={ShieldCheck} size="default" className="mt-0.5 shrink-0 text-secondary" />
          <span>{TEAM_CAN_DO_ALWAYS_YOURS}</span>
        </p>
        <RadioGroup value={b.businessMode} onValueChange={(v) => setBusinessMode.mutate({ businessId, businessMode: v as BusinessMode, reason: "settings" })} aria-label={TEAM_CAN_DO_QUESTION} className="grid grid-cols-3 gap-2" disabled={setBusinessMode.isPending}>
          {TEAM_CAN_DO_OPTIONS.map((o) => {
            const example = businessModeExample(o.mode);
            return (
              <RadioCard
                key={o.mode}
                id={`mode-${o.mode}`}
                value={o.mode}
                label={
                  <>
                    {o.label}
                    {o.recommended ? <span className="font-normal text-secondary"> · Recommended</span> : null}
                  </>
                }
                description={
                  <>
                    <span>{teamCanDoOptionDescription(o.mode, line)}</span>
                    {/* One concrete day under the answer, the line the Commit cards carry. */}
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
        {b.businessMode === "automated" ? (
          // Payment powers (founder, Nov 16, 2026): chosen when the team decides on its own; off, invoices wait for you.
          <div className="flex items-start gap-2" data-testid="payment-powers">
            <Switch id="inbound-payments" checked={(b.paymentPowers ?? []).includes("inbound")} disabled={setPaymentPowers.isPending} onCheckedChange={(on) => setPaymentPowers.mutate({ businessId, paymentPowers: on ? ["inbound"] : [] })} aria-describedby="inbound-payments-help" data-testid="inbound-payments-switch" />
            <div>
              <Label htmlFor="inbound-payments">Agents may create invoices and payment links without asking</Label>
              <p id="inbound-payments-help" className="text-small text-secondary">
                Off, each one waits in Needs you. Money only comes in this way: nothing is ever paid out, refunded or transferred without you.
              </p>
            </div>
          </div>
        ) : null}
        {holiday ? (
          // On vacation agents that follow the business decide on their own (BUILD §9.6); the answer above comes back.
          <p className="flex items-center gap-2 text-body text-secondary" data-testid="mode-in-force">
            <StatusPill tone="info" icon={Palmtree}>
              On vacation: the team decides on its own
            </StatusPill>
            {b.businessMode === "automated" ? null : <span>Your answer above comes back when you do.</span>}
          </p>
        ) : null}
        <Hint>
          An agent can have its own setting on its <Term id="autonomy">Autonomy</Term> tab; every other agent follows the answer you pick here.
        </Hint>
      </SettingsSection>

      <SettingsSection title={SPEND_LINE_QUESTION} data-testid="team-can-do-spend">
        <SpendLineForm businessId={businessId} lineMinor={b.spendCapMinor} currency={currency} mode={b.businessMode} />
      </SettingsSection>

      <WhoAnswers businessId={businessId} mode={b.businessMode} responsibilitiesHref={responsibilitiesHref} />

      <WhenTheTeamStops businessId={businessId} mode={b.businessMode} line={line} holiday={!!holiday} />

      <AutopilotSection />

      <SettingsSection title={<>While you&apos;re on <Term id="vacation">vacation</Term></>}>
        {holiday ? (
          <div className="flex flex-col gap-3" data-testid="holiday-active">
            <StatusPill tone="info" icon={Palmtree}>
              On vacation
            </StatusPill>
            <KeyValueList
              items={[
                { label: "Until", value: holiday.untilAt ? formatLocalDate(holiday.untilAt) : vacationUntilLabel((holiday.untilCondition as { text?: string } | null)?.text) },
                { label: "Budget ceiling", value: holiday.budgetCeilingMinor === null ? "None; the amount per purchase still applies" : formatMoney({ amountMinor: holiday.budgetCeilingMinor, currency: holiday.currency ?? currency }), numeric: true },
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
              Hand the business to the Chief of Staff: <Term id="cycle">cycles</Term> run on their own, decisions within the authority you set, and what always comes to you waits in the Inbox.
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
        <HolidayDialog open={holidayOpen} onOpenChange={setHolidayOpen} currency={currency} initial={{ inboundPayments: (b.paymentPowers ?? []).includes("inbound") }} onSubmit={(settings: HolidaySettings) => startHoliday.mutateAsync({ businessId, ...toStartHolidayInput(settings, currency) }).then(() => undefined)} />
      </SettingsSection>
    </AdminOnly>
  );
}
