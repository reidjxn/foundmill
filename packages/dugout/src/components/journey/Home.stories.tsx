import type { Meta, StoryObj } from "@storybook/react-vite";
import { DateFormatProvider } from "../foundation/DateFormatProvider";
import { FIXTURE_TERMS } from "../guidance/fixtures";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { DayDigest } from "./DayDigest";
import { DepartmentCard } from "./DepartmentCard";
import { departmentCardFixtures, generateJourneyFixture, RIBBON_DEPARTMENTS, squadPulseFixture, trophyFixtures } from "./fixtures";
import { indexDailyRows, summariseDay } from "./ribbon/geometry";
import { SquadPulse } from "./SquadPulse";
import { TrophyCabinet } from "./TrophyCabinet";

const cards = departmentCardFixtures();
const pulse = squadPulseFixture();
const data = generateJourneyFixture({ days: 120, seed: "home" });
const index = indexDailyRows(data.rows, RIBBON_DEPARTMENTS);
const ENTITY_KINDS = { "0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c": "organisation" as const };

const meta = {
  title: "Journey/Home widgets",
  parameters: { docs: { description: { component: "The Home widgets around the Ribbon (BUILD §11.2, DESIGN §9): department cards in every health state, the 7 × 24 team pulse, the milestones and the day digest." } } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const DepartmentCards: Story = {
  name: "Department cards · every health state",
  render: () => (
    <div className="grid w-[1200px] grid-cols-3 gap-gutter">
      {cards.map((d) => (
        <DepartmentCard key={d.id} department={d} entityKinds={ENTITY_KINDS} onOpen={() => {}} onOpenAgent={() => {}} onOpenEntity={() => {}} />
      ))}
    </div>
  ),
};

const quietBase = cards.find((d) => d.now.length === 0)!;
const busy = cards[0]!;

/** Guided mode (UX plan §7.8): the headline metric gets its plain-words line under the figure, from the definitions map or an explicit line. */
export const GuidedMetric: Story = {
  name: "Department cards · the metric in plain words",
  render: () => (
    <GuidanceProvider value={{ terms: FIXTURE_TERMS }}>
      <div className="grid w-[1200px] grid-cols-3 gap-gutter">
        <DepartmentCard department={{ ...busy, metric: { ...busy.metric, label: "Months of cash left", value: "7.4 mo", provenance: "estimate" } }} metricId="runway" entityKinds={ENTITY_KINDS} className="h-full" onOpen={() => {}} />
        <DepartmentCard department={{ ...quietBase, metric: { ...quietBase.metric, label: "Tasks finished this week", value: "12" } }} metricPlain="Tasks the team finished in the last 7 days." className="h-full" onOpen={() => {}} />
        <GuidanceProvider value={{ guidance: "off" }}>
          <DepartmentCard department={{ ...quietBase, id: "q-off", metric: { ...quietBase.metric, label: "Months of cash left", value: "7.4 mo" } }} metricId="runway" className="h-full" onOpen={() => {}} />
        </GuidanceProvider>
      </div>
    </GuidanceProvider>
  ),
};

/**
 * One grid row at Home's height (the department card is 16 grid rows, 368 px): a busy card sets the height and the
 * quiet ones fill "Working on now" with their one line instead of a void; the metric and "Next" sit level across the
 * row. The team strip counts agents on a task ("3 of 4 working") or says what the team is ("2 agents, all healthy").
 */
export const QuietCards: Story = {
  name: "Department cards · quiet, in one row",
  render: () => (
    <div className="flex w-[1200px] flex-col gap-gutter">
      <div className="grid h-[368px] grid-cols-3 gap-gutter">
        <DepartmentCard department={busy} entityKinds={ENTITY_KINDS} className="h-full" onOpen={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-respond", name: "Team", dept: "dept-6", quiet: { kind: "respond", label: "Needs your answer", text: "Set the focus for the next round of work", detail: "2 more in the Inbox" } }} className="h-full" onOpen={() => {}} onOpenQuiet={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-inbox", name: "Finance", dept: "dept-4", quiet: { kind: "inbox", label: "New in your Inbox", text: "VAT return due in nine days" } }} className="h-full" onOpen={() => {}} onOpenQuiet={() => {}} />
      </div>
      <div className="grid h-[368px] grid-cols-3 gap-gutter">
        <DepartmentCard department={{ ...quietBase, quiet: { kind: "finished", label: "Last finished", text: "Customer interview synthesis #8", detail: "Aug 31" } }} className="h-full" onOpen={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-clear", name: "Legal", dept: "dept-7", quiet: { kind: "clear", label: "All clear", text: "Nothing in progress, and nothing waiting on you." } }} className="h-full" onOpen={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-loading", name: "Development", dept: "dept-2", nowLoading: true }} className="h-full" onOpen={() => {}} />
      </div>
      {/* An agent that needs the founder (never "All clear" beside a Down or Failing pill), and work that failed to load. */}
      <div className="grid h-[368px] grid-cols-3 gap-gutter">
        <DepartmentCard department={{ ...quietBase, id: "q-down", name: "Development", dept: "dept-2", health: "bad", healthWord: "Down", quiet: { kind: "attention", label: "Needs you", text: "Data Engineer is down", detail: "Back once reconnected" } }} className="h-full" onOpen={() => {}} onOpenQuiet={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-failed", name: "Product", dept: "dept-1", quiet: { kind: "attention", label: "Last task failed", text: "Draft the pricing page copy", detail: "Oct 11" } }} className="h-full" onOpen={() => {}} onOpenQuiet={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-error", name: "Retail Partnerships", dept: "dept-3", quiet: { kind: "error", label: "Couldn't load", text: "What this department is working on could not be loaded.", detail: "Retry" }, nextUp: "Couldn't load" }} className="h-full" onOpen={() => {}} onOpenQuiet={() => {}} />
      </div>
    </div>
  ),
};

const pulseView = () => (
  <div className="surface-panel w-[800px] p-panel-pad">
    <SquadPulse departments={RIBBON_DEPARTMENTS} days={pulse.days} cells={pulse.cells} onSelect={() => {}} />
  </div>
);

export const Pulse: Story = {
  name: "Team pulse · 7 × 24",
  render: pulseView,
};

const milestonesView = () => (
  <div className="w-[1000px]">
    <TrophyCabinet trophies={trophyFixtures()} onOpen={() => {}} onShare={() => {}} />
  </div>
);

const milestonesOnPageView = () => (
  <div className="w-[1000px]">
    <TrophyCabinet
      trophies={[
        { key: "page_live", label: "Page live", description: "Your project's public page went live.", achievedAt: "2026-11-12T09:00:00.000Z", page: "shown" },
        { key: "first_follower", label: "First follower", description: "The first person confirmed that they follow your project.", achievedAt: "2026-11-14T08:00:00.000Z", page: "hidden" },
        { key: "customer_1", label: "First customer", description: "The first paying customer.", achievedAt: "2026-11-19T10:00:00.000Z", page: "waiting" },
        { key: "customer_10", label: "10th customer", description: "10 paying customers.", achievedAt: null },
      ]}
      onOpen={() => {}}
      onShowOnPage={() => {}}
      onHideFromPage={() => {}}
      onCopyCardLink={() => {}}
    />
  </div>
);

/** The project's public page (0089): "Show on your page", the quiet "On your page" state with Hide and Copy card link, and a milestone shown before whose page is not live. */
export const MilestonesOnThePage: Story = {
  name: "Milestones · shown on the public page",
  render: milestonesOnPageView,
};

export const Milestones: Story = {
  name: "Milestones",
  render: milestonesView,
};

const digestView = () => {
  const day = data.conversions.filter((c) => c.kind === "payment").slice(-1)[0]!.occurredAt.slice(0, 10);
  const summary = summariseDay(day, { index, departments: RIBBON_DEPARTMENTS, conversions: data.conversions, milestones: data.milestones, chapters: data.chapters, today: data.today });
  return <DayDigest summary={summary} currency="EUR" highlights={["Scout sent the wholesale sheet to [[ent:0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c|Nordic Beauty AB]] after the call", "Pixel merged the bundle picker; checkout tests green", "Ledger flagged the Tink consent expiring in 9 days"]} entityKinds={ENTITY_KINDS} onOpenJourney={() => {}} onOpenEntity={() => {}} onPrevDay={() => {}} onNextDay={() => {}} onClose={() => {}} />;
};

export const Digest: Story = {
  name: "Day digest",
  render: digestView,
};

/** The signed-in person's choice (Settings › Preferences): the hour axis on a 24-hour clock and day-first cell names. */
export const PulseDayFirst24h: Story = {
  name: "Team pulse · Day first, 24-hour",
  render: () => (
    <DateFormatProvider value={{ date: "day_first", time: "24h" }}>
      {pulseView()}
    </DateFormatProvider>
  ),
};

export const MilestonesIso: Story = {
  name: "Milestones · ISO dates",
  render: () => <DateFormatProvider value={{ date: "iso", time: "24h" }}>{milestonesView()}</DateFormatProvider>,
};

export const DigestIso24h: Story = {
  name: "Day digest · ISO, 24-hour",
  render: () => <DateFormatProvider value={{ date: "iso", time: "24h" }}>{digestView()}</DateFormatProvider>,
};
