"use client";
/**
 * First-week checklist widget (docs/UX_AUDIT_AND_PLAN.md §6.2, §7.8): the span-4 "Your first week" panel on the
 * Founder's view, fed by `business.firstWeek.get` (one read-only flag per item: the sign-offs, a finished cycle, a
 * note read, a reply sent to an agent, distribution started, a bank or Stripe connected). "Hide" records the
 * dismissal through the guided layer's actions (`account_preferences.checklist_dismissed_at`); once every item is
 * done the panel says so once and records the same. Hidden when complete, dismissed or guidance is off: the cell
 * keeps its place on the grid (DESIGN §2) and shows one line only while the dashboard is being edited, so the founder
 * can see what the empty cell is.
 */
import { useEffect, useMemo, useRef } from "react";
import { z } from "zod";
import { ListChecks } from "lucide-react";
import { DEFAULT_FIRST_WEEK_ITEMS, FirstWeekChecklist, useGuidance, type FirstWeekItem, type FirstWeekItemId } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { moduleHref, useDepartments } from "../shared/departments";
import { WidgetFrame } from "../shared/frame";
import { usePinToHomeMenu, useWidgetInstance } from "../shared/pin";
import { routes } from "../shared/routes";
import type { DepartmentRow, FirstWeekResponse } from "../shared/types";

export const FirstWeekChecklistSettings = z.object({});
export type FirstWeekChecklistSettings = z.infer<typeof FirstWeekChecklistSettings>;

/** The response flag behind each of the seven items. */
export const FIRST_WEEK_FLAGS: Record<FirstWeekItemId, keyof FirstWeekResponse> = {
  sign_off_specification: "specificationSignedOff",
  sign_off_roadmap: "roadmapSignedOff",
  run_cycle: "cycleCompleted",
  read_note: "noteRead",
  talk_to_agent: "conversationReplySent",
  start_distribution: "distributionStarted",
  connect_bank: "bankOrStripeConnected",
};

/** Events after which a flag may have flipped, each with the flags it can flip. */
export const FIRST_WEEK_EVENT_FLAGS: Record<string, readonly (keyof FirstWeekResponse)[]> = {
  "product.signoff_decided": ["specificationSignedOff", "roadmapSignedOff"],
  "cycle.completed": ["cycleCompleted"],
  "inbox.item_updated": ["noteRead"],
  "decision.made": ["noteRead"],
  "conversation.message_posted": ["conversationReplySent"],
  "distribution.started": ["distributionStarted"],
  "bank.balance_updated": ["bankOrStripeConnected"],
  "customer.converted": ["bankOrStripeConnected"],
};
const FIRST_WEEK_EVENTS = Object.keys(FIRST_WEEK_EVENT_FLAGS);

/** How long a burst of events is folded into one refetch (a refetch cancels the one in flight, so each would run in full). */
export const FIRST_WEEK_REFETCH_DEBOUNCE_MS = 400;

/**
 * Whether an event can still change the answer: only while one of the flags it can flip is not yet true (a flag never
 * goes back). Once every flag an event touches is done, that event no longer refetches anything.
 */
export function firstWeekEventMatters(type: string, flags: FirstWeekResponse | undefined): boolean {
  const touched = FIRST_WEEK_EVENT_FLAGS[type];
  if (!touched) return false;
  return !flags || touched.some((flag) => flags[flag] !== true);
}

/** The top bar's Continue button (ContinueButton marks it `data-continue-state`): "Run a cycle" puts the focus on it. */
export function focusContinueButton(): boolean {
  const button = typeof document === "undefined" ? null : document.querySelector<HTMLElement>("[data-continue-state]");
  if (!button) return false;
  button.focus();
  return true;
}

/** Where each item's "Go" leads: the Product tabs, Continue itself, the Inbox, the Team's agents, the Board, Settings › Integrations. */
export function firstWeekHrefs(businessId: string, departments: readonly DepartmentRow[] | undefined): Record<FirstWeekItemId, Pick<FirstWeekItem, "href" | "onGo">> {
  const product = (tab: string) => moduleHref(businessId, departments, "product", tab) ?? routes.department(businessId, "product", tab);
  return {
    sign_off_specification: { href: product("specification") },
    sign_off_roadmap: { href: product("roadmap") },
    run_cycle: { onGo: () => void focusContinueButton() },
    read_note: { href: routes.inbox(businessId) },
    talk_to_agent: { href: moduleHref(businessId, departments, "team", "squad") ?? routes.department(businessId, "team", "squad") },
    start_distribution: { href: moduleHref(businessId, departments, "distribution", "formation") ?? routes.department(businessId, "distribution", "formation") },
    connect_bank: { href: routes.settings(businessId, "integrations") },
  };
}

/** The seven rows: the shared labels, each with its flag and where it goes. */
export function firstWeekItems(flags: FirstWeekResponse | undefined, hrefs: Record<FirstWeekItemId, Pick<FirstWeekItem, "href" | "onGo">>): FirstWeekItem[] {
  return DEFAULT_FIRST_WEEK_ITEMS.map((item) => ({ id: item.id, label: item.label, ...hrefs[item.id], done: flags ? flags[FIRST_WEEK_FLAGS[item.id]] === true : false }));
}

/** Hidden when guidance is off, once dismissed, or once every item is done (the panel says "All done" once first). */
export function checklistHidden(input: { guided: boolean; dismissedAt: string | null; flags: FirstWeekResponse | undefined }): boolean {
  if (!input.guided || input.dismissedAt !== null) return true;
  return !!input.flags && Object.values(FIRST_WEEK_FLAGS).every((flag) => input.flags![flag] === true);
}

const TITLE = "Your first week";

function FirstWeekChecklistWidget({ editing }: WidgetProps<FirstWeekChecklistSettings>) {
  const { businessId } = useWidgetData();
  const { guidance, checklistDismissedAt, dismissChecklist } = useGuidance();
  const guided = guidance === "on";
  const dismissed = checklistDismissedAt !== null;
  const wanted = guided && !dismissed;
  const flags = useWidgetQuery<FirstWeekResponse>("business.firstWeek.get", {}, { enabled: wanted });
  const departments = useDepartments({ enabled: wanted });
  // A burst of events (a cycle's notes, a decision and its updates) folds into one refetch, and an event whose flags
  // are all done already is ignored (perf audit item 10).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchRef = useRef(flags.refetch);
  refetchRef.current = flags.refetch;
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useBusinessEvents((event) => {
    if (!wanted || !firstWeekEventMatters(event.type, flags.data)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      refetchRef.current();
    }, FIRST_WEEK_REFETCH_DEBOUNCE_MS);
  }, FIRST_WEEK_EVENTS);
  const menu = usePinToHomeMenu(useWidgetInstance());
  const hrefs = useMemo(() => firstWeekHrefs(businessId, departments.data), [businessId, departments.data]);
  const items = useMemo(() => firstWeekItems(flags.data, hrefs), [flags.data, hrefs]);
  const allDone = !!flags.data && items.every((i) => i.done);

  if (!wanted) {
    // The cell keeps its place; while editing, one line says what it is (otherwise nothing, the panel is gone).
    if (!editing) return null;
    return <WidgetFrame title={TITLE} data-widget="first_week_checklist" empty={{ icon: ListChecks, text: guided ? "Hidden: you closed the checklist. Settings › Preferences shows it again." : "Hidden while guidance is off. Turn it on in Settings › Preferences." }} />;
  }
  if (!flags.data) return <WidgetFrame title={TITLE} data-widget="first_week_checklist" queries={[flags]} />;
  return (
    <div className="h-full min-h-0" data-widget="first_week_checklist" data-all-done={allDone || undefined}>
      <FirstWeekChecklist items={items} onDismiss={dismissChecklist} onComplete={dismissChecklist} menu={menu ?? undefined} className="h-full" />
    </div>
  );
}

export const firstWeekChecklistWidget = registerWidget<FirstWeekChecklistSettings>({
  key: "first_week_checklist",
  title: "Your first week",
  description: "The seven things to do in a business's first week, ticked off as they happen; it hides itself once they are done.",
  icon: "list-checks",
  surfaces: ["home"],
  // The header plus seven 34 px rows.
  defaultSize: { w: 4, h: 12, minW: 3, minH: 10, maxH: 16 },
  settingsSchema: FirstWeekChecklistSettings,
  defaultSettings: FirstWeekChecklistSettings.parse({}),
  single: true,
  Component: FirstWeekChecklistWidget,
});
