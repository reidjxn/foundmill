import { useState, type CSSProperties, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEPT_COLOUR_TOKENS } from "@foundmill/shared";
import { Fan, Square } from "lucide-react";
import { Icon } from "../components/foundation/Icon";
import { StatusPill } from "../components/foundation/StatusPill";
import { kitStyle } from "../components/shell/KitBar";
import { cn } from "../lib/cn";
import { DURATION_MS, STREAM_CADENCE, TYPING_DOTS } from "../lib/motion";
import { ratingClass } from "../lib/rating";

const meta = {
  title: "Design system/Tokens",
  parameters: { layout: "padded", a11y: { test: "off" } },
} satisfies Meta;
export default meta;

type Story = StoryObj;

function Swatch({ token, note, className }: { token: string; note?: string; className?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={cn("size-10 shrink-0 rounded-sm shadow-elev-0 ring-1 ring-line", className)} style={className ? undefined : { background: `var(${token})` }} />
      <div className="flex min-w-0 flex-col">
        <code className="t-mono text-primary">{token}</code>
        {note ? <span className="t-small text-tertiary">{note}</span> : null}
      </div>
    </div>
  );
}

function Section({ title, meta: metaText, children, className }: { title: string; meta?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("surface-panel overflow-hidden", className)}>
      <header className="rule-fade mx-panel-pad flex h-panel-header items-center gap-2">
        <h2 className="t-title">{title}</h2>
        {metaText ? <span className="t-mono ml-auto text-tertiary">{metaText}</span> : null}
      </header>
      <div className="p-panel-pad">{children}</div>
    </section>
  );
}

export const Palette: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Section title="Surfaces" meta="a deeper canvas, panels lifted by light">
        <div className="grid grid-cols-4 gap-4">
          <Swatch token="--ink" note="terminals, diffs, the generation log" />
          <Swatch token="--canvas" note="the page (alias --bg-base)" />
          <Swatch token="--rail" note="sidebar, list columns" />
          <Swatch token="--surface-1" note="panel body (alias --bg-panel)" />
          <Swatch token="--surface-2" note="raised (alias --bg-panel-alt)" />
          <Swatch token="--surface-3" note="active segment, menus" />
          <Swatch token="--surface-4" note="pressed" />
        </div>
      </Section>
      <Section title="Lines" meta="alpha on white: one set for every surface">
        <div className="grid grid-cols-4 gap-4">
          <Swatch token="--line-faint" note="row dividers" />
          <Swatch token="--line" note="hairlines (alias --line-subtle)" />
          <Swatch token="--line-strong" note="control borders" />
          <Swatch token="--edge-hi" note="light caught at a corner" />
        </div>
      </Section>
      <Section title="Text" meta="WCAG AA on every surface; text-4 is disabled only">
        <div className="grid grid-cols-5 gap-4">
          <Swatch token="--text-1" note="content (text-primary)" />
          <Swatch token="--text-2" note="secondary, labels (text-secondary)" />
          <Swatch token="--text-3" note="captions, units, metadata (text-tertiary)" />
          <Swatch token="--text-4" note="disabled only (text-disabled)" />
          <Swatch token="--reading" note="the note body (text-prose)" />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {(["bg-canvas", "bg-surface-1", "bg-surface-2", "bg-surface-3"] as const).map((bg) => (
            <div key={bg} className={cn("rounded-sm p-2 ring-1 ring-line", bg)}>
              <p className="t-body text-primary">Content in text-1</p>
              <p className="t-body text-secondary">Secondary in text-2</p>
              <p className="t-small text-tertiary">Metadata in text-3 · {bg}</p>
              <p className="t-small text-disabled">Disabled in text-4</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Status and accent">
        <div className="grid grid-cols-5 gap-4">
          <Swatch token="--status-good" />
          <Swatch token="--status-warn" />
          <Swatch token="--status-bad" />
          <Swatch token="--status-info" />
          <Swatch token="--accent" note="focus, selection" />
        </div>
        <div className="mt-3 flex gap-2">
          <StatusPill tone="good">Healthy</StatusPill>
          <StatusPill tone="warn">Degraded</StatusPill>
          <StatusPill tone="bad">Failing</StatusPill>
          <StatusPill tone="info">Scheduled</StatusPill>
          <StatusPill tone="neutral">Idle</StatusPill>
        </div>
      </Section>
      <Section title="Brand ramp" meta="derived from each business's primary in OKLCH (kitRamp)">
        <div className="flex flex-col gap-3">
          {[
            { name: "Foundmill steel (no business: the stylesheet defaults)", kit: null },
            { name: "Northwind", kit: { primary: "#2E7D6B", secondary: "#E8C56B" } },
            { name: "Navy", kit: { primary: "#1A237E", secondary: "#FFFFFF" } },
            { name: "Lemon", kit: { primary: "#F5E050", secondary: "#1A1A1A" } },
            { name: "Crimson", kit: { primary: "#E63946", secondary: "#FFFFFF" } },
          ].map((b) => (
            <div key={b.name} className="grid grid-cols-7 items-center gap-3" style={b.kit ? kitStyle(b.kit) : undefined}>
              <span className="t-label">{b.name}</span>
              {["--kit-primary", "--kit-lift", "--kit-hi", "--kit-lo", "--kit-deep", "--kit-aura"].map((t) => (
                <Swatch key={t} token={t} />
              ))}
            </div>
          ))}
        </div>
      </Section>
      <Section title="Departments">
        <div className="grid grid-cols-4 gap-4">
          {DEPT_COLOUR_TOKENS.map((t) => (
            <Swatch key={t} token={`--${t}`} />
          ))}
        </div>
      </Section>
      <Section title="Gold" meta="Customer Updates, milestones, customers, stars">
        <div className="grid grid-cols-3 gap-4">
          <Swatch token="--gold" />
          <Swatch token="--gold-deep" note="gradient end" />
          <div className="h-10 rounded-sm" style={{ background: "linear-gradient(90deg, var(--gold), var(--gold-deep))" }} />
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
            <div className={`h-6 w-5 rounded-xs ${ratingClass(v, { background: true })}`} />
            <span className={`t-small tabular ${ratingClass(v)}`}>{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 t-small text-tertiary">1–5 red · 6–10 amber · 11–15 light green · 16–20 bold green, weight 600. Numbers always accompany the colour.</p>
    </Section>
  ),
};

const TYPE: Array<{ cls: string; spec: string; where: string; sample: ReactNode }> = [
  { cls: "t-figure-hero", spec: "Barlow 600, 54/56, tabular", where: "The one hero figure per screen", sample: <><span className="t-currency">£</span>2,374</> },
  { cls: "t-display-xl", spec: "Barlow 600, 40/44", where: "Win moment", sample: "Ada Holm is a customer" },
  { cls: "t-display-lg", spec: "Barlow 600, 30/32, tabular", where: "Tile figures", sample: <><span className="t-currency">£</span>4,255<span className="t-decimals">.57</span> · 94<span className="t-unit">%</span></> },
  { cls: "t-display-md", spec: "Barlow 600, 20/24", where: "Screen titles, profile names", sample: "Boots UK wants a 40-store trial" },
  { cls: "t-display-sm", spec: "Barlow 600, 16/20", where: "Business name, card names", sample: "Northwind Skincare" },
  { cls: "t-title", spec: "Inter 600, 13/18, sentence case", where: "Panel titles", sample: "Time and budget" },
  { cls: "t-action", spec: "Inter 500, 13/16, sentence case (alias t-tab)", where: "Buttons, tabs, sidebar, quick replies", sample: "Live sessions" },
  { cls: "t-label", spec: "Inter 500, 12/16, text-2", where: "Form labels, table headers, chips", sample: "Budget you can commit" },
  { cls: "t-data", spec: "Barlow 600, 10.5/14, caps +0.09em, text-3", where: "The only caps: data labels", sample: "Last 7 days" },
  { cls: "t-body", spec: "Inter 400, 13/19", where: "Everything else", sample: "Juno modelled it: 2,400 units on sale-or-return at a 33% margin." },
  { cls: "t-reading", spec: "Inter 400, 15/24, −0.006em, reading colour", where: "Inbox note body (640 px measure)", sample: "The catch is 60-day payment terms. Cash dips to £41K in December, then recovers by February." },
  { cls: "t-chat", spec: "Inter 400, 13.5/20", where: "Conversation bubbles", sample: "Still positive. At 40% we clear £6,100 and the unsold units come back in time for Ireland." },
  { cls: "t-small", spec: "Inter 400, 12/16", where: "Captions, metadata", sample: "1 account · synced 09:12" },
  { cls: "t-mono", spec: "JetBrains Mono 450, 12/18, tabular", where: "Timestamps, tokens, provenance", sample: "14:06:21 · 4,812 tokens · 0:19" },
  { cls: "t-micro", spec: "JetBrains Mono 500, 11/12", where: "Axis ticks, kbd", sample: "13 Aug  27 Aug  10 Sep" },
];

export const TypeScale: Story = {
  render: () => (
    <Section title="Type scale" meta="sentence case; caps only on data labels">
      <div className="flex flex-col divide-y divide-line-faint">
        {TYPE.map((t) => (
          <div key={t.cls} className="grid grid-cols-4 items-baseline gap-4 py-3">
            <div className="flex flex-col">
              <code className="t-mono text-accent">.{t.cls}</code>
              <span className="t-small text-tertiary">{t.spec}</span>
              <span className="t-small text-tertiary">{t.where}</span>
            </div>
            <div className={cn("col-span-3", t.cls)}>{t.sample}</div>
          </div>
        ))}
      </div>
    </Section>
  ),
};

const HEIGHTS = [
  ["control-xs", "22", "chips, pills, tags", "h-control-xs"],
  ["control-sm", "28", "small buttons, segmented", "h-control-sm"],
  ["control-md", "32", "buttons, sidebar rows, quick replies", "h-control-md"],
  ["field", "36", "text fields", "h-field"],
  ["control-lg", "40", "large primary, decision buttons", "h-control-lg"],
  ["field-lg", "46", "MoneyInput, selects in forms", "h-field-lg"],
  ["control-xl", "48", "the generate control", "h-control-xl"],
] as const;

export const ShapeAndDepth: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Section title="Control heights" meta="px tokens: the root is 13 px, so numeric spacing runs at 13/16">
        <div className="flex items-end gap-3">
          {HEIGHTS.map(([name, px, note, cls]) => (
            <div key={name} className="flex w-32 flex-col gap-1">
              <div className={cn("surface-raised w-full rounded-sm", cls)} />
              <code className="t-mono text-primary">
                {name} · {px}
              </code>
              <span className="t-small text-tertiary">{note}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Radii" meta="3 / 6 / 10 / 14 / pill — never 16">
        <div className="flex items-center gap-4">
          {(["rounded-xs", "rounded-sm", "rounded-md", "rounded-lg", "rounded-pill"] as const).map((r) => (
            <div key={r} className="flex flex-col items-center gap-1">
              <div className={cn("surface-raised size-16", r)} />
              <code className="t-mono text-secondary">{r}</code>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Elevation and glow" meta="glows only from light sources">
        <div className="grid grid-cols-4 gap-6 p-2">
          {(["shadow-elev-0", "shadow-elev-1", "shadow-elev-2", "shadow-elev-3"] as const).map((s) => (
            <div key={s} className={cn("flex h-20 items-end rounded-md bg-surface-1 p-2", s)}>
              <code className="t-mono text-secondary">{s}</code>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-6">
          {(["shadow-glow-good", "shadow-glow-warn", "shadow-glow-bad", "shadow-glow-info", "shadow-glow-gold"] as const).map((s, i) => (
            <span key={s} className="inline-flex items-center gap-2">
              <span className={cn("size-2 rounded-pill", s, ["bg-status-good", "bg-status-warn", "bg-status-bad", "bg-status-info", "bg-gold"][i])} />
              <code className="t-mono text-secondary">{s}</code>
            </span>
          ))}
          <span className="inline-flex h-control-md items-center rounded-sm bg-kit-primary px-3 t-action text-kit-on-primary shadow-glow-kit">shadow-glow-kit</span>
          <button type="button" className="focus-ring h-control-md rounded-sm px-3 t-action surface-raised">Tab to me: focus-ring</button>
        </div>
      </Section>
    </div>
  ),
};

export const Light: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Section title="surface-panel">
          <p className="t-body text-secondary">Surface 1, a 1 px gradient edge lit at the top left, a top light, elev-1.</p>
        </Section>
        <Section title="glow-dept + edge-tint" className="glow-dept edge-tint tone-dept-2">
          <p className="t-body text-secondary">A department panel: the department colour as light from the lit corner (tone-dept-2).</p>
        </Section>
        <Section title="glow-brand" className="glow-brand" meta="the Journey, the brief">
          <p className="t-body text-secondary">Brand light from the lit corner, in the business&apos;s aura colour.</p>
        </Section>
      </div>
      <Section title="Controls and wells">
        <div className="flex flex-wrap items-center gap-3">
          <span className="surface-raised pressable inline-flex h-control-md items-center rounded-sm px-3 t-action">surface-raised · pressable</span>
          <span className="surface-well focus-within-ring inline-flex h-field w-64 items-center rounded-sm px-3">
            <input aria-label="Example field" className="min-w-0 flex-1 bg-transparent t-body outline-none placeholder:text-tertiary" placeholder="surface-well · focus-within-ring" />
          </span>
          <span className="edge inline-flex h-control-md items-center rounded-sm bg-surface-2 px-3 t-action">edge</span>
          <span className="edge edge-tint tone-dept-3 inline-flex h-control-md items-center rounded-sm bg-surface-2 px-3 t-action">edge + edge-tint</span>
          <span className="t-data rounded-xs px-1.5 py-0.5 dashed-edge">Estimate</span>
        </div>
      </Section>
      <section className="relative flex h-kitbar items-center gap-3 overflow-hidden rounded-md px-3 text-kit-on-primary" style={{ ...kitStyle({ primary: "#2E7D6B", secondary: "#E8C56B" }), background: "linear-gradient(90deg, color-mix(in oklab, var(--kit-primary) 92%, transparent), color-mix(in oklab, var(--kit-primary) 38%, transparent)), var(--ink)" }}>
        <span aria-hidden className="specular pointer-events-none absolute inset-0" />
        <span className="t-display-sm">Northwind Skincare</span>
        <span className="glass relative inline-flex h-control-md items-center rounded-sm px-3 t-action">glass chip</span>
        <span className="glass relative inline-flex h-control-md items-center rounded-sm px-3 t-action">9 Oct 2026 · 14 mo</span>
      </section>
      <Section title="Generate: sheen at rest, orbit while running">
        <div className="flex items-center gap-4">
          <span className="sheen inline-flex h-control-xl items-center gap-3 rounded-lg bg-primary pl-2 pr-4 text-ink shadow-glow-kit">
            <span className="grid size-8 place-items-center rounded-sm bg-kit-primary text-kit-on-primary">
              <Icon icon={Fan} />
            </span>
            <span className="t-action">Draft 12 concepts (hover)</span>
          </span>
          <span className="orbit inline-flex h-control-xl items-center gap-3 rounded-lg bg-surface-2 pl-2 pr-4">
            <span className="grid size-8 place-items-center rounded-sm bg-kit-primary text-kit-on-primary">
              <Icon icon={Fan} className="animate-fan" />
            </span>
            <span className="t-action">Drafting concepts</span>
            <span className="t-mono rounded-xs bg-surface-3 px-1.5 text-secondary">2 of 12</span>
          </span>
          <span className="surface-raised inline-flex h-control-md items-center gap-2 rounded-sm px-3 t-action">
            <Icon icon={Square} size="inline" />
            Stop
          </span>
        </div>
      </Section>
    </div>
  ),
};

function SlidingTabs() {
  const tabs = ["All", "Respond", "Customers", "Updates", "Archive"];
  const [active, setActive] = useState(0);
  const widths = [36, 78, 88, 72, 70];
  const x = widths.slice(0, active).reduce((a, b) => a + b + 4, 0);
  return (
    <div className="relative flex h-tabbar items-stretch gap-1 border-b border-line">
      {tabs.map((t, i) => (
        <button key={t} type="button" onClick={() => setActive(i)} className={cn("t-action px-2.5 transition-colors duration-hover", i === active ? "text-primary" : "text-tertiary hover:text-secondary")} style={{ width: widths[i] }}>
          {t}
        </button>
      ))}
      <span aria-hidden className="slide-indicator" style={{ "--indicator-x": `${x + 10}px`, "--indicator-w": `${widths[active]! - 20}px` } as CSSProperties} />
    </div>
  );
}

export const Motion: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Section title="Skeleton shimmer" meta="1600 ms, 60 ms stagger">
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={cn("shimmer h-3 rounded-xs", `stagger-${i}`, i % 2 ? "w-1/2" : "w-2/3")} />
            ))}
          </div>
        </Section>
        <Section title="Presence, typing, streaming" meta={`breathe ${DURATION_MS.breathe} ms · dots ${TYPING_DOTS.loopMs} ms · caret ${STREAM_CADENCE.caretBlinkMs} ms`}>
          <div className="flex flex-col gap-3">
            <span className="inline-flex items-center gap-3">
              <span className="presence-breathe tone-status-good inline-block size-9 rounded-pill bg-dept-3 ring-2 ring-status-good ring-offset-2 ring-offset-surface-1" />
              <span className="t-body">Juno · Live · typing</span>
            </span>
            <span className="inline-flex items-center gap-2 t-small text-tertiary">
              <span className="typing-dots tone-dept-3">
                <span />
                <span />
                <span />
              </span>
              Juno is typing · reading Boots UK&apos;s supplier terms
            </span>
            <p className="stream-caret tone-dept-3 t-chat">The bigger lever is the 60-day terms. I&apos;m asking Boots for 45</p>
          </div>
        </Section>
      </div>
      <Section title="Sliding indicator" meta={`slide ${DURATION_MS.slide} ms, ease-inout`}>
        <SlidingTabs />
      </Section>
      <Section title="Landed cards" meta="rise 8 px, fade, kit-lift edge settling over 1200 ms">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={cn("landed surface-raised rounded-md p-3", `stagger-${i * 4}`)}>
              <p className="t-display-sm">Concept {i + 1}</p>
              <p className="t-small text-tertiary">Just in</p>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Durations">
        <dl className="grid grid-cols-6 gap-x-3 gap-y-1">
          {Object.entries(DURATION_MS).map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="t-data">{k}</dt>
              <dd className="t-mono">{v} ms</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  ),
};
