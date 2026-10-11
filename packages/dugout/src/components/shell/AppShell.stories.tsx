import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleCheck, Hourglass, Landmark, TrendingUp, Trophy, Users } from "lucide-react";
import { formatMoney } from "../../lib/format";
import { Avatar, AvatarStack } from "../foundation/Avatar";
import { SAMPLE_LOGOS } from "../foundation/logo-samples";
import { Button } from "../foundation/Button";
import { DeptChip, ProvenanceChip } from "../foundation/Chip";
import { Icon, type IconComponent } from "../foundation/Icon";
import { Sparkline } from "../foundation/Sparkline";
import { StatusPill } from "../foundation/StatusPill";
import { AppShell, type AppShellProps } from "./AppShell";
import { GridCell, PageGrid } from "./PageGrid";
import { Panel } from "./Panel";
import { DISTRIBUTION_TABS, FIXTURE_TODAY, NORTHWIND_KIT, NORTHWIND_SEGMENTS, NORTHWIND_SIDEBAR, PALETTE_ITEMS, RECENT_PALETTE_ITEMS } from "./fixtures";
import type { ContinueState, SidebarItem } from "./types";

const meta = {
  title: "Shell/AppShell",
  component: AppShell,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Sidebar left on the rail, the brand glass slab on top (KitBar), the processing strip, the tab bar over the lit canvas, the content grid, an optional right rail (BUILD §5.3). The brand is applied as CSS variables on the root (and on the document while mounted, so portaled overlays take it too); the keyboard map (BUILD §5.5) is bound; / and ⌘K open the command palette, ? opens the keyboard help. Below 1280 px only NeedsLargerWindow renders.",
      },
    },
  },
  argTypes: { mode: { control: "inline-radio", options: ["live", "personal"] }, businessMode: { control: "inline-radio", options: ["augmented", "assisted", "automated"] } },
} satisfies Meta<typeof AppShell>;
export default meta;
type Story = StoryObj<typeof meta>;

/* ---------- Realistic Home content (DESIGN §9) ---------- */

const CASH_SERIES = [182, 179, 176, 174, 171, 169, 168, 165, 163, 160, 158, 156, 155, 153, 151, 149, 148, 146, 145, 143, 141, 140, 138, 137, 135, 134, 132, 131, 130, 128];

function StatTile({ icon, label, value, caption, provenance }: { icon: IconComponent; label: string; value: string; caption?: string; provenance?: "forecast" | "estimate" }) {
  return (
    <GridCell span={4} className="surface-panel flex items-center gap-3 p-panel-pad">
      <span className="inline-flex size-8 items-center justify-center rounded-panel bg-panel-alt text-secondary">
        <Icon icon={icon} />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="t-label">{label}</span>
        <span className="t-display-lg inline-flex items-center gap-2 text-primary">
          {value}
          {provenance ? <ProvenanceChip kind={provenance} /> : null}
        </span>
        {caption ? <span className="text-small text-secondary">{caption}</span> : null}
      </div>
    </GridCell>
  );
}

/** Static maps so Tailwind emits the classes (dynamic `bg-${dept}` strings are invisible to it). */
const DOT_CLASS: Record<string, string> = { "dept-1": "bg-dept-1", "dept-2": "bg-dept-2", "dept-3": "bg-dept-3", "dept-4": "bg-dept-4", "dept-5": "bg-dept-5", "dept-6": "bg-dept-6", "dept-7": "bg-dept-7", "dept-8": "bg-dept-8" };
const TEXT_CLASS: Record<string, string> = { "dept-1": "text-dept-1", "dept-2": "text-dept-2", "dept-3": "text-dept-3", "dept-4": "text-dept-4", "dept-5": "text-dept-5", "dept-6": "text-dept-6", "dept-7": "text-dept-7", "dept-8": "text-dept-8" };

const DEPARTMENTS = [
  { id: "d-product", name: "Product", dept: "dept-1" as const, lead: "Compass", health: "good" as const, now: ["Compass is rewriting the retinol serum spec from 14 customer interviews", "Roadmap: fall bundle slipped 3 days"], metric: "6 of 7 roadmap items on track", series: [4, 4, 5, 5, 6, 6, 6] },
  { id: "d-development", name: "Formulation Lab", dept: "dept-2" as const, lead: "Forge", health: "warn" as const, now: ["Forge is waiting for approval: packaging schema change", "Pixel merged the bundle picker (PR #212)"], metric: "9 tasks merged this week", series: [3, 5, 4, 6, 7, 8, 9] },
  { id: "d-distribution", name: "Distribution", dept: "dept-3" as const, lead: "Scout", health: "good" as const, now: ["Scout drafted the Nordic Beauty AB reply", "Beacon paused Meta ads: CPA up 24%"], metric: "€38 blended cost per customer", series: [52, 48, 46, 44, 41, 40, 38] },
  { id: "d-finance", name: "Finance", dept: "dept-4" as const, lead: "Ledger", health: "good" as const, now: ["Ledger categorized 42 transactions", "VAT return due in 9 days"], metric: "11 mo runway", series: [12.4, 12.1, 11.9, 11.6, 11.4, 11.2, 11] },
  { id: "d-team", name: "Team", dept: "dept-5" as const, lead: "Atlas", health: "good" as const, now: ["Atlas scheduled training for Beacon (Creative judgment)", "Team health 92"], metric: "92 team health", series: [88, 89, 90, 90, 91, 92, 92] },
  { id: "d-legal", name: "Legal", dept: "dept-6" as const, lead: "Clause", health: "warn" as const, now: ["Clause flagged the influencer agreement: exclusivity clause", "Trademark check: 2 similar marks"], metric: "9 days to next filing", series: [30, 27, 24, 20, 16, 12, 9] },
];

function DepartmentCard({ d }: { d: (typeof DEPARTMENTS)[number] }) {
  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className={`inline-block size-1.5 rounded-full ${DOT_CLASS[d.dept]}`} />
          {d.name}
        </span>
      }
      span={4}
      actions={<StatusPill tone={d.health}>{d.health === "good" ? "Healthy" : "Waiting"}</StatusPill>}
      menu={{ onSwap: () => {}, onSettings: () => {}, onPinToHome: () => {} }}
      footer={<span>Next up: {d.id === "d-distribution" ? "launch the fall bundle campaign" : "weekly review with the Chief of Staff"}</span>}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-body-strong">
            <Avatar name={d.lead} size={24} agent={{ seed: d.lead, dept: d.dept }} status="healthy" />
            {d.lead}
          </span>
          <AvatarStack size={20} items={Array.from({ length: 5 }, (_, i) => ({ name: `${d.name} ${i + 1}`, agent: { seed: `${d.id}-${i}`, dept: d.dept }, status: i === 3 ? ("degraded" as const) : i === 4 ? ("idle" as const) : ("healthy" as const) }))} />
        </div>
        <ul className="flex flex-col gap-1 text-body text-primary">
          {d.now.map((line) => (
            <li key={line} className="truncate">
              {line}
            </li>
          ))}
        </ul>
        <div className="flex items-end justify-between gap-2">
          <span className="t-display-sm text-primary">{d.metric}</span>
          <Sparkline data={d.series} width={96} height={28} className={TEXT_CLASS[d.dept]} />
        </div>
      </div>
    </Panel>
  );
}

function HomeContent() {
  return (
    <PageGrid>
      <Panel title="Journey Ribbon" span={12} bodyClassName="h-72" empty={{ icon: TrendingUp, children: "The river of agent work and the revenue line draw here once the Journey package lands.", title: "Two years of synthetic data" }} />
      <StatTile icon={Landmark} label="Cash" value={formatMoney({ amountMinor: 12800000, currency: "EUR" })} caption="Bank balance, 2 min ago" />
      <StatTile icon={Hourglass} label="Runway" value="11 mo" provenance="estimate" caption="Burn €11.6k/mo" />
      <StatTile icon={TrendingUp} label="Revenue (30 d)" value={formatMoney({ amountMinor: 1120000, currency: "EUR" })} caption="▲ 8.4% vs previous 30 d" />
      <StatTile icon={Users} label="Customers this week" value="23" caption="4 from Nordic Beauty AB" />
      <StatTile icon={CircleCheck} label="Business health" value="86" caption="3 warnings" />
      <StatTile icon={Trophy} label="Leaderboard position" value="14th" caption="DTC skincare · 212 businesses" />
      {DEPARTMENTS.map((d) => (
        <DepartmentCard key={d.id} d={d} />
      ))}
      <Panel title="Cash" span={8} footer="Bank balance from Tink · updated 2 min ago">
        <Sparkline data={CASH_SERIES} width={720} height={120} className="text-kit-primary" />
      </Panel>
      <Panel title="Inbox preview" span={4} menu={{ onPinToHome: () => {} }} flush>
        <ul className="divide-y divide-subtle">
          {[
            ["Approve the retinol serum reorder", "Decision · Operations", true],
            ["Nordic Beauty AB placed its 4th order", "Customer won · Distribution", false],
            ["CPA on Meta moved 24%", "Warning · Distribution", true],
            ["Bundle picker shipped", "Update · Formulation Lab", false],
          ].map(([subject, meta, required]) => (
            <li key={subject as string} className="flex items-center gap-2 px-panel-pad py-2">
              {required ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-status-bad" /> : <span className="size-1.5 shrink-0" />}
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body-strong">{subject as string}</span>
                <span className="truncate text-small text-secondary">{meta as string}</span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </PageGrid>
  );
}

/* ---------- Stateful wrapper so the sidebar, tabs and rail work in the story ---------- */

function Shell({ children, sidebar, tabs, rightRail, ...props }: Partial<AppShellProps> & { children?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(sidebar?.collapsed ?? false);
  const [activeId, setActiveId] = useState(sidebar?.activeId ?? "home");
  const [tab, setTab] = useState(tabs?.activeId ?? "formation");
  const [railOpen, setRailOpen] = useState(rightRail?.open ?? true);
  const [pulseKey, setPulseKey] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 8));
  const navigate = (item: SidebarItem) => {
    setActiveId(item.id);
    note(`Navigate → ${item.label}`);
  };
  const rail: AppShellProps["rightRail"] = rightRail
    ? {
        title: "Decision preview",
        open: railOpen,
        onOpenChange: setRailOpen,
        children: (
          <div className="flex flex-col gap-2 text-body">
            <p className="text-secondary">Keyboard and click events land here.</p>
            <Button size="sm" onClick={() => setPulseKey((k) => k + 1)}>
              Simulate cycle finished (pulse)
            </Button>
            <ul className="font-mono text-mono text-secondary">
              {log.map((l, i) => (
                <li key={`${l}-${i}`}>{l}</li>
              ))}
            </ul>
          </div>
        ),
      }
    : undefined;
  return (
    <AppShell
      mode="live"
      businessMode="assisted"
      kit={NORTHWIND_KIT}
      logoSrc={SAMPLE_LOGOS.stack}
      businessName="Northwind Skincare"
      screenTitle="Home"
      nav={{ onBack: () => note("Back"), onForward: () => note("Forward"), canGoForward: false }}
      date={FIXTURE_TODAY}
      runwayMonths={11}
      cash={{ amountMinor: 12800000, currency: "EUR" }}
      continueButton={{ state: { kind: "idle" }, onContinue: () => note("Continue"), onRespond: () => note("Respond"), onPause: () => note("Pause"), onGoToJourney: () => note("Go to Journey"), onComeBack: () => note("Come back"), pulseKey }}
      stopAll={{ onConfirm: () => new Promise<void>((r) => setTimeout(r, 900)), runningCount: 7 }}
      processing={{ segments: NORTHWIND_SEGMENTS, active: true }}
      search={{ items: PALETTE_ITEMS, recent: RECENT_PALETTE_ITEMS, onSelect: (item) => note(`Open ${item.label}`) }}
      keyboard={{ onRefreshInbox: () => note("Refresh Inbox"), onEditLayout: () => note("Edit layout"), onNextInboxItem: () => note("Next item"), onPrevInboxItem: () => note("Previous item") }}
      onNavigate={navigate}
      viewportWidth={1440}
      {...props}
      sidebar={{ items: sidebar?.items ?? NORTHWIND_SIDEBAR, activeId, collapsed, onCollapsedChange: setCollapsed, brand: sidebar?.brand ?? { href: "/" } }}
      tabs={tabs ? { tabs: tabs.tabs, activeId: tab, activeSubViewId: tab === "channels" ? "paid" : undefined, onChange: (id) => setTab(id) } : undefined}
      rightRail={rail}
    >
      {children ?? <HomeContent />}
    </AppShell>
  );
}

const baseArgs = {
  mode: "live",
  businessMode: "assisted",
  kit: NORTHWIND_KIT,
  logoSrc: SAMPLE_LOGOS.stack,
  businessName: "Northwind Skincare",
  screenTitle: "Home",
  sidebar: { items: NORTHWIND_SIDEBAR, activeId: "home", collapsed: false, onCollapsedChange: () => {} },
  continueButton: { state: { kind: "idle" } as ContinueState },
  stopAll: { onConfirm: () => {} },
  processing: { segments: NORTHWIND_SEGMENTS, active: true },
  date: FIXTURE_TODAY,
  runwayMonths: 11,
} satisfies Partial<AppShellProps>;

export const FoundersView: Story = {
  name: "Founder's view",
  args: baseArgs,
  render: (args) => <Shell {...args} rightRail={{ open: true, onOpenChange: () => {}, children: null }} tabs={{ tabs: DISTRIBUTION_TABS, activeId: "formation" }} />,
  parameters: { docs: { description: { story: "Seeded Northwind Skincare: seven departments with badges, the processing strip running for four of them, LIVE block, right rail logging every shortcut. Try Space, G then N, /, ? and E." } } },
};

export const ContinueBlocked: Story = {
  args: { ...baseArgs, continueButton: { state: { kind: "blocked", count: 3 } } },
  render: (args) => <Shell {...args} />,
};
export const ContinueProcessing: Story = {
  args: { ...baseArgs, continueButton: { state: { kind: "processing" } } },
  render: (args) => <Shell {...args} />,
};
export const ContinueCustomerUpdate: Story = {
  name: "Continue · Customer Update",
  args: { ...baseArgs, continueButton: { state: { kind: "matchday" } }, processing: { segments: NORTHWIND_SEGMENTS, active: false } },
  render: (args) => <Shell {...args} />,
};
export const ContinueHoliday: Story = {
  name: "Continue on vacation",
  args: { ...baseArgs, businessMode: "automated", continueButton: { state: { kind: "holiday", until: "2026-10-21" } } },
  render: (args) => <Shell {...args} />,
};
export const PersonalModeCollapsed: Story = {
  name: "Personal mode, collapsed sidebar",
  args: { ...baseArgs, mode: "personal", sidebar: { ...baseArgs.sidebar, collapsed: true } },
  render: (args) => <Shell {...args} />,
};
export const WithTabsAndBreadcrumbs: Story = {
  args: { ...baseArgs, screenTitle: "Distribution", breadcrumbs: [{ label: "Distribution" }, { label: "Board" }] },
  render: (args) => (
    <Shell {...args} tabs={{ tabs: DISTRIBUTION_TABS, activeId: "formation" }}>
      <PageGrid>
        <Panel title="Board" span={8} loading />
        <Panel title="Off the board" span={4} empty="Channels not on the board sit here." />
      </PageGrid>
    </Shell>
  ),
};
export const SecondBrandColours: Story = {
  name: "Other brand colors (Ledgerly)",
  args: { ...baseArgs, kit: { primary: "#1F6F5F", secondary: "#E8C56B" }, businessName: "Ledgerly", logoSrc: null },
  render: (args) => <Shell {...args} />,
};
export const NeedsLargerWindowAt1279: Story = {
  name: "1279 px → NeedsLargerWindow",
  args: { ...baseArgs, viewportWidth: 1279 },
  render: (args) => <Shell {...args} />,
  parameters: { docs: { description: { story: "Below the 1280 px minimum the shell renders NeedsLargerWindow and nothing else (DESIGN §2)." } } },
};
export const MeasuresTheWindow: Story = {
  name: "Measures the real window",
  args: baseArgs,
  render: (args) => <Shell {...args} viewportWidth={undefined} />,
  parameters: { docs: { description: { story: "No viewportWidth prop: the shell measures window.innerWidth through useViewportWidth. Narrow the Storybook canvas below 1280 px to see the switch." } } },
};
export const DeptChipLegend: Story = {
  name: "Department chips",
  args: baseArgs,
  render: () => (
    <div className="flex flex-wrap gap-2 p-4">
      {DEPARTMENTS.map((d) => (
        <DeptChip key={d.id} dept={d.dept}>
          {d.name}
        </DeptChip>
      ))}
    </div>
  ),
  parameters: { layout: "padded" },
};
export const At1280: Story = {
  name: "1280 px window",
  args: { ...baseArgs, viewportWidth: 1280, screenTitle: "Retail Partnerships", continueButton: { state: { kind: "blocked", count: 2 } } },
  render: (args) => <Shell {...args} tabs={{ tabs: DISTRIBUTION_TABS, activeId: "formation" }} />,
  parameters: { docs: { description: { story: "The minimum window: the search gives way first (placeholder → “Search” → icon); the title and every chip keep their words." } } },
};
