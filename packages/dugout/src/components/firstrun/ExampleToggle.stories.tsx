import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button, GenerateControl } from "../foundation/Button";
import { Input } from "../foundation/Input";
import { Field } from "../foundation/Label";
import { MoneyInput } from "../foundation/MoneyInput";
import { RadioCard, RadioGroup } from "../foundation/RadioGroup";
import { Textarea } from "../foundation/Textarea";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { ReassuranceLine } from "../guidance/ReassuranceLine";
import { Panel } from "../shell/Panel";
import { PageGrid } from "../shell/PageGrid";
import { ExampleFrame, ExampleToggle } from "./ExampleToggle";

const meta = {
  title: "Guidance/ExampleToggle",
  component: ExampleToggle,
  parameters: {
    docs: {
      description: {
        component:
          "A ghost Show me an example that swaps a panel body or a form value for a labeled example: the neutral Example chip inside a dashed edge (dashed never means measured). Hide the example puts it back and clears only what the example filled. With options it is a group of chips under one lead label. Guidance off: not rendered.",
      },
    },
  },
  decorators: [
    (Story) => (
      <PageGrid flush>
        <Story />
      </PageGrid>
    ),
  ],
  args: {
    example: (
      <p className="text-body text-primary">A skincare brand for sensitive skin, sold online, for people who have given up on the high street. Starts with one serum.</p>
    ),
  },
} satisfies Meta<typeof ExampleToggle>;
export default meta;
type Story = StoryObj<typeof meta>;

const InPanel = ({ children, title = "The brief" }: { children: React.ReactNode; title?: string }) => (
  <Panel title={title} span={6}>
    {children}
  </Panel>
);

export const PanelBody: Story = {
  render: (args) => (
    <InPanel>
      <ExampleToggle {...args} />
    </InPanel>
  ),
};

export const Shown: Story = {
  args: { defaultShown: true },
  render: (args) => (
    <InPanel>
      <ExampleToggle {...args} />
    </InPanel>
  ),
};

/** A form that swaps its own values through the render-prop and frames them itself. */
export const FormValues: Story = {
  args: { example: undefined },
  render: (args) => (
    <InPanel>
      <ExampleToggle {...args}>
        {(shown) => {
          const fields = (
            <div className="flex flex-col gap-3">
              <Field htmlFor="ex-name" label="Business name">
                <Input id="ex-name" readOnly={shown} value={shown ? "Northwind Skincare" : undefined} placeholder="What you will call it" />
              </Field>
              <Field htmlFor="ex-line" label="One line">
                <Textarea id="ex-line" readOnly={shown} value={shown ? "A serum for sensitive skin, sold online." : undefined} placeholder="Who it is for and what it does" />
              </Field>
            </div>
          );
          return shown ? <ExampleFrame>{fields}</ExampleFrame> : fields;
        }}
      </ExampleToggle>
    </InPanel>
  ),
};

/* ---------- the three uses in the product (UX plan §10 Phase 3) ---------- */

const EXAMPLE_FOUNDER = { time: "evenings_weekends", budget: "5000", constraints: ["Keep my day job for now", "No physical inventory"] };

function FounderProfileExample() {
  const [time, setTime] = useState("");
  const [budget, setBudget] = useState("");
  const [constraints, setConstraints] = useState<string[]>([]);
  const [before, setBefore] = useState<{ time: string; budget: string; constraints: string[] } | null>(null);
  const on = before !== null;
  const fill = () => {
    setBefore({ time, budget, constraints });
    setTime(EXAMPLE_FOUNDER.time);
    setBudget(EXAMPLE_FOUNDER.budget);
    setConstraints(EXAMPLE_FOUNDER.constraints);
  };
  // Only what the example filled goes back: an answer the founder changed meanwhile stays.
  const clear = () => {
    if (!before) return;
    if (time === EXAMPLE_FOUNDER.time) setTime(before.time);
    if (budget === EXAMPLE_FOUNDER.budget) setBudget(before.budget);
    if (constraints.join("|") === EXAMPLE_FOUNDER.constraints.join("|")) setConstraints(before.constraints);
    setBefore(null);
  };
  const fields = (
    <div className="flex flex-col gap-4">
      <Field htmlFor="pf-time" label="Time commitment">
        <RadioGroup id="pf-time" value={time} onValueChange={setTime} className="grid-cols-2" aria-label="Time commitment">
          <RadioCard id="pf-time-full" value="full_time" label="Full time" description="40 hours a week or more." />
          <RadioCard id="pf-time-ev" value="evenings_weekends" label="Evenings and weekends" description="Around 10 hours a week." />
        </RadioGroup>
      </Field>
      <Field htmlFor="pf-budget" label="Budget you can commit" hint="Your own money for the first year, before any revenue.">
        <MoneyInput id="pf-budget" value={budget} onValueChange={setBudget} currency="GBP" placeholder="25000" />
      </Field>
      <Field htmlFor="pf-constraints" label="Constraints">
        <Input id="pf-constraints" value={constraints.join(", ")} onChange={(e) => setConstraints(e.target.value ? e.target.value.split(/,\s*/) : [])} placeholder="Add a constraint and press Enter" />
      </Field>
    </div>
  );
  return (
    <Panel
      title="Add detail (optional, improves the ideas)"
      span={8}
      actions={<ExampleToggle shown={on} onFill={fill} onClear={clear} />}
      footer={on ? <ReassuranceLine>Replace the example with your own answers to continue.</ReassuranceLine> : <ReassuranceLine icon="settings">Everything here can be changed later in Settings.</ReassuranceLine>}
    >
      <div className="flex flex-col gap-4">
        {on ? <ExampleFrame>{fields}</ExampleFrame> : fields}
        <div>
          <Button variant="primary" disabled={on}>
            Continue
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** The founder profile: the toggle sits in the section's header, fills the fields, and Continue waits until the example is hidden. */
export const FounderProfile: Story = {
  render: () => <FounderProfileExample />,
};

const BRIEFS = ["Help independent tutors send parents a weekly recap", "A subscription for refillable skincare", "AI playtesters for indie games"];

function ExampleBriefGroup() {
  const [brief, setBrief] = useState("");
  const [example, setExample] = useState<string | null>(null);
  const exampleIn = example !== null && brief === example;
  const textarea = <Textarea id="brief" aria-label="Brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder="A problem you have seen, a market you know, or nothing at all." />;
  return (
    <Panel title="Brief for the Ideation agent" span={8}>
      <div className="flex flex-col gap-3">
        <ExampleToggle
          options={BRIEFS.map((text) => ({ id: text, label: text }))}
          label="Try an example brief"
          value={exampleIn ? example : null}
          onFill={(id) => {
            setBrief(id ?? "");
            setExample(id ?? null);
          }}
          onClear={() => {
            setBrief("");
            setExample(null);
          }}
        />
        {exampleIn ? <ExampleFrame>{textarea}</ExampleFrame> : textarea}
        <div className="flex justify-end">
          <GenerateControl label={brief.trim() ? (exampleIn ? "Draft 6–12 ideas from this example" : "Draft concepts") : "Draft 6–12 ideas for me"} />
        </div>
      </div>
    </Panel>
  );
}

/** The Ideation Studio: a group of example briefs; the chosen one tags the textarea until the founder edits it, and never drafts by itself. */
export const ExampleBrief: Story = {
  render: () => <ExampleBriefGroup />,
};

const DRIVERS = [
  { key: "cash", label: "Starting cash", kind: "money", real: "150000", example: "30000" },
  { key: "revenue", label: "Monthly revenue", kind: "money", real: "20000", example: "4000" },
  { key: "growth", label: "Revenue growth", kind: "percent", real: "5", example: "5" },
  { key: "costs", label: "Monthly costs", kind: "money", real: "35000", example: "7500" },
] as const;

function RunwayDriversExample() {
  const [on, setOn] = useState(false);
  const fields = (
    <div className="grid grid-cols-4 gap-gutter">
      {DRIVERS.map((d) => (
        <Field key={d.key} htmlFor={`rd-${d.key}`} label={d.label}>
          {d.kind === "money" ? <MoneyInput id={`rd-${d.key}`} currency="EUR" value={on ? d.example : d.real} readOnly={on} onValueChange={() => undefined} /> : <Input id={`rd-${d.key}`} value={on ? d.example : d.real} readOnly={on} suffix="%" onChange={() => undefined} />}
        </Field>
      ))}
    </div>
  );
  return (
    <Panel title="Drivers" span={12} help="The figures the forecast is worked out from." actions={<ExampleToggle shown={on} onToggle={setOn} />} footer={on ? "An example is never saved: hide it to get your own drivers back." : "Saving creates a new forecast version; the previous one is kept for the audit trail."}>
      <div className="flex flex-col gap-3">
        {on ? <ExampleFrame>{fields}</ExampleFrame> : fields}
        <div className="flex items-center gap-2">
          <Button variant="primary" disabled={on}>
            Save Base forecast
          </Button>
          <Button variant="ghost" disabled>
            Reset
          </Button>
          <span className="text-small text-secondary">{on ? "Example runway with these drivers: 11 mo" : "Base runway with these drivers: 14 mo"}</span>
        </div>
      </div>
    </Panel>
  );
}

/** Finance › Runway: the example scenario fills the driver form, is never saved, and Hide the example restores the real values. */
export const RunwayDrivers: Story = {
  render: () => <RunwayDriversExample />,
};

export const GuidanceOff: Story = {
  render: (args) => (
    <GuidanceProvider value={{ guidance: "off" }}>
      <InPanel>
        <ExampleToggle {...args} defaultShown />
        <p className="text-small text-tertiary">Guidance is off: no toggle, no example.</p>
      </InPanel>
    </GuidanceProvider>
  ),
};
