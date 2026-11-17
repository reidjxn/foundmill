import type { Meta, StoryObj } from "@storybook/react-vite";
import { RatingKey } from "./RatingKey";

const meta = {
  title: "Guidance/RatingKey",
  component: RatingKey,
  parameters: { docs: { description: { component: "The rating legend, once on any screen that shows a 1–20 rating: each ramp swatch beside its range and band word (WP-10 T9)." } } },
} satisfies Meta<typeof RatingKey>;
export default meta;

export const Default: StoryObj<typeof meta> = {};
export const Compact: StoryObj<typeof meta> = { args: { compact: true } };
