import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { GenerateControl } from "../foundation/Button";
import { LiveRun, type LiveRunItem, type LiveRunStep } from "./LiveRun";
import {
  ISOLDE,
  MARLOW,
  NOOR,
  PIKE,
  RUN_ACTIVITY,
  RUN_ITEMS,
  RUN_LOG,
  RUN_STEPS,
  TEODOR,
} from "./fixtures";

const meta = {
  title: "Conversation/LiveRun",
  component: LiveRun,
  parameters: {
    docs: {
      description: {
        component:
          "Under the generate control while it runs (SPEC \"Live run panel\"): the step rail, a segment per card (landed, drafting, queued, empty), a mono meter with Estimates spelled in full, who is doing what, and a one-line log on ink streaming the active drafter's reasoning. Props only; colors from each drafter's department or kit-lift.",
      },
    },
  },
  args: {
    steps: RUN_STEPS,
    items: RUN_ITEMS,
    meter: {
      tokens: 4812,
      elapsedMs: 19_000,
      remainingMs: 40_000,
      cost: { amountMinor: 21, currency: "GBP" },
    },
    activity: RUN_ACTIVITY,
    log: RUN_LOG,
  },
  decorators: [
    (Story) => (
      <div className="surface-panel glow-brand max-w-300 overflow-hidden">
        <div className="flex items-center justify-end gap-3 p-5">
          <GenerateControl
            label="Draft 12 concepts"
            runningLabel="Drafting concepts"
            running
            progress={2.45 / 12}
            count="2 of 12"
            onStop={() => undefined}
          />
        </div>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LiveRun>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Two cards landed, Marlow drafting the third, Teodor next. */
export const Running: Story = {};

/** The first seconds: the slate is being written; every card is queued. */
export const Starting: Story = {
  args: {
    steps: [
      {
        id: "profile",
        label: "Read your profile",
        detail: "Skills, time, budget · 0.3 s",
        state: "done",
      },
      {
        id: "slate",
        label: "Slate of 12 angles",
        detail: "Isolde is naming them",
        state: "current",
        people: [ISOLDE],
      },
      { id: "draft", label: "Drafting cards", detail: "Four drafters ready", state: "pending" },
      { id: "ground", label: "Grounding", detail: "Noor: rivals, size, prices", state: "pending" },
      { id: "rank", label: "Rank and explain", detail: "Best fit for you first", state: "pending" },
    ],
    items: Array.from({ length: 12 }, (_, i): LiveRunItem => ({
      id: `q${i}`,
      state: i < 4 ? "queued" : "empty",
    })),
    meter: {
      tokens: 612,
      elapsedMs: 2_400,
      remainingMs: 58_000,
      cost: { amountMinor: 2, currency: "GBP" },
    },
    activity: [{ person: ISOLDE, verb: "writing", object: "the slate of 12 angles" }],
    log: {
      person: ISOLDE,
      atLabel: "14:05:58",
      text: "Angles: patch-test kits, a pharmacist-readable safe list, B2B stability data",
      open: true,
    },
  },
};

/** Done: every step green, the bar full, no estimates left. */
export const Done: Story = {
  args: {
    status: "done",
    steps: RUN_STEPS.map((s): LiveRunStep => ({
      ...s,
      state: "done",
      people: undefined,
      detail: s.id === "draft" ? "12 landed" : s.detail,
    })),
    items: Array.from({ length: 12 }, (_, i): LiveRunItem => ({ id: `d${i}`, state: "landed" })),
    meter: { tokens: 21_406, elapsedMs: 58_000, cost: { amountMinor: 94, currency: "GBP" } },
    activity: [],
    log: {
      person: NOOR,
      atLabel: "14:06:59",
      text: "Ranked: Northwind first for fit with your skills and budget",
    },
  },
};

/** Stopped by the founder, one card could not be finished. */
export const Stopped: Story = {
  args: {
    status: "stopped",
    steps: RUN_STEPS.map((s): LiveRunStep =>
      s.id === "draft"
        ? { ...s, state: "failed", detail: "Stopped · 3 landed", people: undefined }
        : s,
    ),
    items: RUN_ITEMS.map((i): LiveRunItem =>
      i.state === "drafting"
        ? { ...i, state: "failed" }
        : i.state === "queued"
          ? { ...i, state: "empty" }
          : i,
    ),
    meter: { tokens: 5_120, elapsedMs: 21_000, cost: { amountMinor: 22, currency: "GBP" } },
    activity: [],
    log: {
      person: MARLOW,
      atLabel: "14:06:24",
      text: "Stopped on your request; Shelfproof was not finished",
    },
  },
};

/** A live run that moves: cards land one by one, the log streams. */
export const Live: Story = {
  render: (args) => {
    const Demo = () => {
      const [t, setT] = useState(0);
      useEffect(() => {
        if (t >= 12) return;
        const h = setTimeout(() => setT((x) => x + 1), 1600);
        return () => clearTimeout(h);
      }, [t]);
      const drafters = [ISOLDE, PIKE, MARLOW, TEODOR];
      const who = drafters[t % 4]!;
      const items = Array.from({ length: 12 }, (_, i): LiveRunItem => ({
        id: `l${i}`,
        state: i < t ? "landed" : i === t ? "drafting" : i < t + 3 ? "queued" : "empty",
        progress: 0.4,
        dept: i === t ? who.dept : undefined,
      }));
      return (
        <LiveRun
          {...args}
          status={t >= 12 ? "done" : "running"}
          steps={RUN_STEPS.map((s): LiveRunStep =>
            s.id === "draft"
              ? {
                  ...s,
                  detail: `${t} landed · ${t < 12 ? 1 : 0} in progress`,
                  state: t >= 12 ? "done" : "current",
                  people: t >= 12 ? undefined : [who],
                }
              : s,
          )}
          items={items}
          meter={{
            tokens: 1200 + t * 1600,
            elapsedMs: 3000 + t * 1600,
            remainingMs: (12 - t) * 1600,
            cost: { amountMinor: 3 + t * 7, currency: "GBP" },
          }}
          activity={
            t >= 12 ? [] : [{ person: who, verb: "drafting", object: `concept ${t + 1} of 12` }]
          }
          log={{
            person: who,
            atLabel: `2:06:${String(10 + t).padStart(2, "0")} PM`,
            text: `Concept ${t + 1}: weighing market pull against capital intensity for a UK and Ireland launch`,
            open: t < 12,
          }}
        />
      );
    };
    return <Demo />;
  },
};
