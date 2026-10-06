import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEPT_COLOUR_TOKENS } from "@founder-manager/shared";
import { StatusPill } from "../components/foundation/StatusPill";
import { ratingClass } from "../lib/rating";

const meta = {
  title: "Dugout/Tokens",
  parameters: { layout: "padded", a11y: { test: "off" } },
} satisfies Meta;
export default meta;

type Story = StoryObj;

function Swatch({ token, note, className }: { token: string; note?: string; className?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`size-10 shrink-0 rounded-panel border border-subtle ${className ?? ""}`} style={className ? undefined : { background: `var(${token})` }} />
      <div className="flex flex-col">
        <code className="font-mono text-mono text-primary">{token}</code>
        {note ? <span className="text-small text-secondary">{note}</span> : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface-panel overflow-hidden">
      <header className="flex h-panel-header items-center border-b border-subtle bg-panel-alt px-3">
        <h2 className="t-label">{title}</h2>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export const Palette: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Section title="Surfaces — the luminance ladder">
        <div className="grid grid-cols-5 gap-4">
          <Swatch token="--bg-ink" note="terminals, diffs" />
          <Swatch token="--bg-base" note="page" />
          <Swatch token="--bg-panel" note="panel body" />
          <Swatch token="--bg-panel-alt" note="raised, inputs, headers" />
          <Swatch token="--line-subtle" note="1 px hairlines" />
        </div>
      </Section>
      <Section title="Text and links">
        <div className="grid grid-cols-3 gap-4">
          <Swatch token="--text-primary" note="content" />
          <Swatch token="--text-secondary" note="labels, metadata" />
          <Swatch token="--accent-link" note="links, entities, focus" />
        </div>
      </Section>
      <Section title="Status">
        <div className="grid grid-cols-4 gap-4">
          <Swatch token="--status-good" />
          <Swatch token="--status-warn" />
          <Swatch token="--status-bad" />
          <Swatch token="--status-info" />
        </div>
        <div className="mt-3 flex gap-2">
          <StatusPill tone="good">Healthy</StatusPill>
          <StatusPill tone="warn">Degraded</StatusPill>
          <StatusPill tone="bad">Failing</StatusPill>
          <StatusPill tone="info">Scheduled</StatusPill>
          <StatusPill tone="neutral">Idle</StatusPill>
        </div>
      </Section>
      <Section title="Kit — the business identity, used with restraint">
        <div className="grid grid-cols-3 gap-4">
          <Swatch token="--kit-primary" note="Continue, active edge, crest" />
          <Swatch token="--kit-secondary" />
          <Swatch token="--kit-on-primary" note="computed by APCA Lc ≥ 75" />
        </div>
      </Section>
      <Section title="Departments">
        <div className="grid grid-cols-4 gap-4">
          {DEPT_COLOUR_TOKENS.map((t) => (
            <Swatch key={t} token={`--${t}`} />
          ))}
        </div>
      </Section>
      <Section title="Gold — Match Day, trophies, customer won">
        <div className="grid grid-cols-3 gap-4">
          <Swatch token="--gold" />
          <Swatch token="--gold-deep" note="gradient end" />
          <div className="h-10 rounded-panel" style={{ background: "linear-gradient(90deg, var(--gold), var(--gold-deep))" }} />
        </div>
      </Section>
    </div>
  ),
};

export const RatingRamp: Story = {
  render: () => (
    <Section title="Rating ramp 1–20">
      <div className="flex items-end gap-1">
        {Array.from({ length: 20 }, (_, i) => i + 1).map((v) => (
          <div key={v} className="flex flex-col items-center gap-1">
            <div className={`h-6 w-5 rounded-chip ${ratingClass(v, { background: true })}`} />
            <span className={`text-small ${ratingClass(v)}`}>{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-small text-secondary">1–5 red · 6–10 amber · 11–15 light green · 16–20 bold green, weight 600. Numbers always accompany the colour.</p>
      <div className="mt-3 flex gap-px">
        {Array.from({ length: 20 }, (_, i) => (
          <div key={i} className={`h-2 w-3 ${i < 14 ? "bg-rating-3" : "bg-panel-alt"}`} />
        ))}
        <span className={`ml-2 t-display-sm ${ratingClass(14)}`}>14</span>
      </div>
    </Section>
  ),
};

const TYPE: Array<{ cls: string; spec: string; where: string; sample?: string }> = [
  { cls: "t-display-xl", spec: "Barlow Semi Condensed 600, 40/44", where: "Goal moment, hero numbers", sample: "€128,400" },
  { cls: "t-display-lg", spec: "Barlow 600, 28/32", where: "Tile numbers, status strip", sample: "14.2 months" },
  { cls: "t-display-md", spec: "Barlow 600, 20/24", where: "Screen titles, profile names", sample: "Northwind Skincare" },
  { cls: "t-display-sm", spec: "Barlow 600, 15/20", where: "Panel subtitles", sample: "Attribution by channel" },
  { cls: "t-tab", spec: "Barlow 600, 13/16, uppercase, 0.04em", where: "Tab bar, sidebar", sample: "Training Ground" },
  { cls: "t-label", spec: "Barlow 600, 11/14, uppercase, 0.06em, secondary", where: "Panel titles, table headers, chips", sample: "Runway" },
  { cls: "t-body", spec: "Inter 400, 13/19", where: "Everything else", sample: "The lead agent shipped the onboarding fix and opened a pull request." },
  { cls: "t-body-strong", spec: "Inter 500, 13/19", where: "Subjects, names in rows", sample: "Pricing page rewrite" },
  { cls: "t-reading", spec: "Inter 400, 15/24", where: "Inbox note body (640 px measure)", sample: "Two activations came through the SEO channel overnight. Both signed up from the comparison article; one has already connected a bank feed." },
  { cls: "t-small", spec: "Inter 400, 12/16", where: "Metadata, timestamps", sample: "Updated 3 min ago · Estimate" },
  { cls: "t-mono", spec: "JetBrains Mono 400, 12/18", where: "Logs, diffs, ids", sample: "claude-sonnet · 12.4K tokens · $0.19" },
];

export const TypeScale: Story = {
  render: () => (
    <Section title="Type scale">
      <div className="flex flex-col divide-y divide-subtle">
        {TYPE.map((t) => (
          <div key={t.cls} className="grid grid-cols-[180px_1fr] items-baseline gap-4 py-3">
            <div className="flex flex-col">
              <code className="font-mono text-mono text-link">.{t.cls}</code>
              <span className="text-small text-secondary">{t.spec}</span>
              <span className="text-small text-secondary">{t.where}</span>
            </div>
            <div className={t.cls}>{t.sample}</div>
          </div>
        ))}
      </div>
    </Section>
  ),
};

const SPACING = [
  ["4 px", "half-step, inline tightness", "w-1"],
  ["8 px", "grid unit", "w-2"],
  ["12 px", "panel padding", "w-3"],
  ["16 px", "content gutters", "w-4"],
  ["20 px", "chips, pills", "w-5"],
  ["28 px", "compact row, sm button", "w-7"],
  ["32 px", "md button, input, panel header", "w-8"],
  ["34 px", "comfortable row", "w-row-comfortable"],
  ["40 px", "tab bar", "w-10"],
  ["56 px", "kit bar", "w-14"],
  ["64 px", "collapsed sidebar", "w-16"],
  ["232 px", "sidebar", "w-sidebar"],
  ["320 px", "right rail, hover card", "w-rail"],
] as const;

export const Spacing: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Section title="Spacing and sizes — 8 px grid, 4 px half-steps">
        <div className="flex flex-col gap-2">
          {SPACING.map(([px, note, cls]) => (
            <div key={px} className="grid grid-cols-[72px_1fr_240px] items-center gap-3">
              <code className="font-mono text-mono text-primary">{px}</code>
              <div className={`h-3 rounded-chip bg-kit-primary ${cls}`} />
              <span className="text-small text-secondary">{note}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Radii, depth, motion">
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <div className="surface-panel h-16 p-2 text-small text-secondary">Panel · 4 px radius, inner highlight, no shadow</div>
            <div className="surface-overlay h-16 p-2 text-small text-secondary">Overlay · 0 12px 32px rgba(0,0,0,.55)</div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="shimmer h-4 w-2/3 rounded-chip" />
            <div className="shimmer h-4 w-1/2 rounded-chip" />
            <span className="text-small text-secondary">Skeleton shimmer 1.6 s</span>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
            <dt className="text-secondary">ease</dt>
            <dd className="font-mono text-mono">cubic-bezier(0.2, 0.8, 0.2, 1)</dd>
            <dt className="text-secondary">micro</dt>
            <dd className="font-mono text-mono">120 ms</dd>
            <dt className="text-secondary">panel</dt>
            <dd className="font-mono text-mono">200 ms</dd>
            <dt className="text-secondary">view</dt>
            <dd className="font-mono text-mono">320 ms</dd>
            <dt className="text-secondary">ribbon</dt>
            <dd className="font-mono text-mono">1200 ms</dd>
          </dl>
        </div>
      </Section>
    </div>
  ),
};
