import type { Meta, StoryObj } from "@storybook/react-vite";
import { cn } from "../../lib/cn";
import { ratingClass, scaleCaption } from "../../lib/rating";
import { StarRating } from "../foundation/StarRating";
import { Tooltip } from "../foundation/Tooltip";
import { FormKey, ScaleLabel } from "./ScaleLabel";

const meta = {
  title: "Guidance/ScaleLabel",
  component: ScaleLabel,
  parameters: {
    docs: {
      description: {
        component:
          "The word beside a number (UX plan §6.2, principle 4): the band word (Poor / Average / Good / Excellent, the product's own words) in a 22 px pill with a dot in the ramp tone. A 1–20 attribute, a /10 average and stars out of 5 all map onto the same bands; `scaleCaption()` gives the “/20”, “/10”, “of 5” beside the figure. `compact` drops the plate for a 28 px row. Always shown. `FormKey` is the sentence behind the five Form cells, for a Tooltip.",
      },
    },
  },
  args: { value: 13, scale: 20 },
  argTypes: { scale: { control: "inline-radio", options: [20, 10, 5] } },
} satisfies Meta<typeof ScaleLabel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Compact: Story = { args: { compact: true } };

const ROWS: Array<{ name: string; value: number; scale: 20 | 10 | 5 }> = [
  { name: "Planning (attribute)", value: 17, scale: 20 },
  { name: "Rating (average)", value: 7.5, scale: 10 },
  { name: "Ability (stars)", value: 3.5, scale: 5 },
  { name: "Finance (attribute)", value: 4, scale: 20 },
];

/** Every scale carries its caption and its word: the same bands behind /20, /10 and stars. */
export const EveryScale: Story = {
  name: "Every scale with its caption",
  render: () => (
    <div className="surface-panel flex w-128 flex-col divide-y divide-subtle p-3">
      {ROWS.map((r) => (
        <div key={r.name} className="flex h-row-comfortable items-center gap-4">
          <span className="w-44 text-body text-secondary">{r.name}</span>
          {r.scale === 5 ? (
            <StarRating value={r.value} label={r.name} />
          ) : (
            <span className={cn("t-display-sm w-16 text-right", ratingClass(r.scale === 10 ? r.value * 2 : r.value))}>
              {r.value}
              <span className="t-unit">{scaleCaption(r.scale)}</span>
            </span>
          )}
          <ScaleLabel value={r.value} scale={r.scale} compact={r.scale === 10} />
        </div>
      ))}
    </div>
  ),
};

/** The Form cells get a key on hover: "Last 5 tasks: 4 went well, 1 partly, 0 failed". */
export const FormKeyStory: Story = {
  name: "Form key",
  render: () => (
    <div className="flex items-center gap-3 text-body">
      <span className="text-secondary">Form</span>
      <Tooltip content={<FormKey cells={["success", "success", "partial", "success", "success"]} />}>
        <button type="button" className="inline-flex gap-0.5 rounded-xs focus-ring" aria-label="Form, last five: went well, went well, partly, went well, went well">
          {(["success", "success", "partial", "success", "success"] as const).map((c, i) => (
            <span key={i} aria-hidden className={cn("size-2.5 rounded-xs cell-lit", c === "success" ? "tone-status-good" : "tone-status-warn")} />
          ))}
        </button>
      </Tooltip>
      <FormKey cells={["success", "success", "partial", "success", "success"]} className="text-tertiary" />
    </div>
  ),
};
