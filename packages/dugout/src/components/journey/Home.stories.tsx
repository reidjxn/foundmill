import type { Meta, StoryObj } from "@storybook/react-vite";
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

/**
 * One grid row at Home's height (the department card is 16 grid rows, 368 px): a busy card sets the height and the
 * quiet ones fill "Now" with their one line instead of a void; the metric and "Next up" sit level across the row.
 */
export const QuietCards: Story = {
  name: "Department cards · quiet, in one row",
  render: () => (
    <div className="flex w-[1200px] flex-col gap-gutter">
      <div className="grid h-[368px] grid-cols-3 gap-gutter">
        <DepartmentCard department={busy} entityKinds={ENTITY_KINDS} className="h-full" onOpen={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-respond", name: "Team", dept: "dept-6", quiet: { kind: "respond", label: "Waiting for you", text: "Set the focus for the next cycle", detail: "2 more in the Inbox" } }} className="h-full" onOpen={() => {}} onOpenQuiet={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-inbox", name: "Finance", dept: "dept-4", quiet: { kind: "inbox", label: "New in your Inbox", text: "VAT return due in nine days" } }} className="h-full" onOpen={() => {}} onOpenQuiet={() => {}} />
      </div>
      <div className="grid h-[368px] grid-cols-3 gap-gutter">
        <DepartmentCard department={{ ...quietBase, quiet: { kind: "finished", label: "Last finished", text: "Customer interview synthesis #8", detail: "31 Aug" } }} className="h-full" onOpen={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-clear", name: "Legal", dept: "dept-7", quiet: { kind: "clear", label: "All clear", text: "Nothing in progress, and nothing waiting on you." } }} className="h-full" onOpen={() => {}} />
        <DepartmentCard department={{ ...quietBase, id: "q-loading", name: "Development", dept: "dept-2", nowLoading: true }} className="h-full" onOpen={() => {}} />
      </div>
    </div>
  ),
};

export const Pulse: Story = {
  name: "Team pulse · 7 × 24",
  render: () => (
    <div className="surface-panel w-[800px] p-panel-pad">
      <SquadPulse departments={RIBBON_DEPARTMENTS} days={pulse.days} cells={pulse.cells} onSelect={() => {}} />
    </div>
  ),
};

export const Milestones: Story = {
  name: "Milestones",
  render: () => (
    <div className="w-[1000px]">
      <TrophyCabinet trophies={trophyFixtures()} onOpen={() => {}} onShare={() => {}} />
    </div>
  ),
};

export const Digest: Story = {
  name: "Day digest",
  render: () => {
    const day = data.conversions.filter((c) => c.kind === "payment").slice(-1)[0]!.occurredAt.slice(0, 10);
    const summary = summariseDay(day, { index, departments: RIBBON_DEPARTMENTS, conversions: data.conversions, milestones: data.milestones, chapters: data.chapters, today: data.today });
    return <DayDigest summary={summary} highlights={["Scout sent the wholesale sheet to [[ent:0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c|Nordic Beauty AB]] after the call", "Pixel merged the bundle picker; checkout tests green", "Ledger flagged the Tink consent expiring in 9 days"]} entityKinds={ENTITY_KINDS} onOpenJourney={() => {}} onOpenEntity={() => {}} onPrevDay={() => {}} onNextDay={() => {}} onClose={() => {}} />;
  },
};
