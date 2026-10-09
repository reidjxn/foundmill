import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, Check, Clock, MessageCircle, Pause, PenLine, Play, Plus, ThumbsUp, Trash2 } from "lucide-react";
import { Button, GenerateControl } from "./Button";

const meta = {
  title: "Foundation/Button",
  component: Button,
  args: { children: "Continue", variant: "default", size: "md" },
  argTypes: {
    variant: { control: "select", options: ["primary", "default", "secondary", "ghost", "danger", "gold", "tinted", "generate"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg", "xl"] },
    tone: { control: "select", options: ["accent", "kit", "good", "warn", "bad", "info", "gold", "dept-3"] },
    icon: { control: false },
    iconRight: { control: false },
  },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { variant: "primary", children: "Save and continue", iconRight: ArrowRight } };
export const Ghost: Story = { args: { variant: "ghost", children: "Swap content" } };
export const Danger: Story = { args: { variant: "danger", children: "Stop all agents", icon: Trash2 } };
export const Tinted: Story = { args: { variant: "tinted", children: "Yes, ask for 45 days", icon: Check } };
export const Small: Story = { args: { size: "sm", children: "Pin to Home" } };
export const WithIcon: Story = { args: { icon: Plus, children: "Hire agent" } };
export const WithTrailingIcon: Story = { args: { iconRight: ArrowRight, children: "Go to Journey", variant: "gold" } };
export const Loading: Story = { args: { loading: true, children: "Executing" } };
export const Disabled: Story = { args: { disabled: true, children: "Unavailable" } };
export const ActiveToggle: Story = { args: { active: true, tone: "warn", icon: MessageCircle, children: "Ask Juno" } };

/** Every variant at every size: sentence case, Inter 500, the icon first, a 1 px press with a spring release. */
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(["xl", "lg", "md", "sm"] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-2">
          <span className="t-data w-6">{size}</span>
          <Button size={size} variant="primary" icon={Play}>
            Continue
          </Button>
          <Button size={size} variant="default">
            Secondary
          </Button>
          <Button size={size} variant="tinted">
            Yes, ask for 45 days
          </Button>
          <Button size={size} variant="ghost">
            Ghost
          </Button>
          <Button size={size} variant="danger" icon={Pause}>
            Respond · 1
          </Button>
          <Button size={size} variant="gold">
            Customer Update
          </Button>
          <Button size={size} active tone="warn" icon={MessageCircle}>
            Ask Juno
          </Button>
          <Button size={size} loading>
            Loading
          </Button>
          <Button size={size} disabled>
            Disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};

/**
 * Two-line decision options (DESIGN §8 DecisionBar): each option carries its consequence under its label; the
 * recommended one is primary with a thumbs-up and an inline caps tag. Options wrap, never truncate.
 */
export const DecisionOptions: Story = {
  render: () => (
    <div className="flex max-w-3xl flex-wrap items-stretch gap-2">
      <Button variant="primary" icon={ThumbsUp} tag="Recommended" description="£18,600 deposit today">
        Approve
      </Button>
      <Button icon={Clock} description="Stock-out risk in Nov">
        Hold a week
      </Button>
      <Button icon={MessageCircle} description="Talk it through first">
        Ask Juno
      </Button>
    </div>
  ),
};

/** `lines={2}`: a long label wraps to two lines and the button grows; it never clips. */
export const TwoLineLabel: Story = {
  render: () => (
    <div className="flex w-64 flex-col gap-2">
      <Button lines={2} icon={Check}>
        Order two SKUs now, the serum after its stability review
      </Button>
      <Button lines={2} variant="primary">
        Approve the full purchase order
      </Button>
    </div>
  ),
};

/**
 * `fit`: in a fixed slot the label steps down to its floor, then truncates with a tooltip on the button (hover the
 * last one). Drag the slot narrower in the canvas to watch it fit.
 */
export const FitInATightSlot: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {[220, 150, 110, 80].map((w) => (
        <div key={w} className="flex items-center gap-3">
          <span className="w-12 font-mono text-mono text-tertiary">{w} px</span>
          <div className="resize-x overflow-hidden border border-dashed border-line p-1" style={{ width: w }}>
            <Button fit icon={PenLine} className="w-full">
              Settings · Departments
            </Button>
          </div>
        </div>
      ))}
    </div>
  ),
};

/** The generate control at rest: the only light slab in the product, the brand core tile with the Fan glyph. */
export const Generate: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button variant="generate" size="xl" kbd="⌘↵">
        Draft 12 concepts
      </Button>
      <Button variant="generate" size="lg">
        Draft a plan
      </Button>
      <Button variant="generate" size="md">
        Draft a cover plan
      </Button>
      <Button variant="generate" size="sm">
        More like this
      </Button>
    </div>
  ),
};

/** Running: a dark slab, a light arc orbiting the edge, the fan turning, real progress and the count. */
export const GenerateRunning: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-4">
      <Button variant="generate" size="xl" running progress={2 / 12} count="2 of 12">
        Drafting concepts
      </Button>
      <Button variant="generate" size="xl" running count="Starting">
        Drafting concepts
      </Button>
      <Button variant="generate" size="sm" running progress={0.6} count="3 of 5">
        Drafting
      </Button>
    </div>
  ),
};

function LiveGenerate() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setDone((d) => (d >= 12 ? d : d + 1)), 900);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => {
    if (done >= 12) setRunning(false);
  }, [done]);
  return (
    <div className="surface-panel glow-brand flex items-center justify-between gap-4 p-5" style={{ width: 720 }}>
      <span className="text-small text-tertiary">Twelve cards. Each one lands as soon as its drafter finishes.</span>
      <GenerateControl
        label="Draft 12 concepts"
        runningLabel="Drafting concepts"
        kbd="⌘↵"
        running={running}
        progress={done / 12}
        count={`${done} of 12`}
        onGenerate={() => {
          setDone(0);
          setRunning(true);
        }}
        onStop={() => setRunning(false)}
      />
    </div>
  );
}

/** GenerateControl: press it; Stop sits beside it while it runs and the count rolls per landed card. */
export const GenerateControlLive: Story = { name: "GenerateControl", render: () => <LiveGenerate /> };
