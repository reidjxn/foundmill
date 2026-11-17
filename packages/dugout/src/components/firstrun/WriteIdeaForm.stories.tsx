import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { WRITE_IDEA_WORDS, WriteIdeaForm, type WriteIdeaFormProps, type WriteIdeaValues } from "./WriteIdeaForm";

/**
 * A phone start without a card (WP-04 T15): /new/write, at the two widths it is checked at, 390 px and 1440 px. The
 * frame sets the width; the button lays itself out from its container (`@page-wide`).
 */
const meta = {
  title: "Guidance/Write an idea",
  component: WriteIdeaForm,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: `"${WRITE_IDEA_WORDS.title}" / "${WRITE_IDEA_WORDS.lede}": a working name and the idea in the person's own words, then "${WRITE_IDEA_WORDS.submit}". Pure: the screen writes the idea and opens Commit.`,
      },
    },
  },
  args: { values: { name: "", pitch: "" }, onChange: () => undefined, onSubmit: () => undefined },
  render: function Stateful(args: WriteIdeaFormProps) {
    const [values, setValues] = useState<WriteIdeaValues>(args.values);
    return <WriteIdeaForm {...args} values={values} onChange={setValues} />;
  },
} satisfies Meta<typeof WriteIdeaForm>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line bg-canvas p-gutter">
    <Story />
  </div>
);
const Wide: Decorator = (Story) => (
  <div className="@container flex w-full justify-center bg-canvas p-gutter">
    <Story />
  </div>
);

const WRITTEN = { name: "Plant swap", pitch: "Neighbors trade houseplant cuttings on one street, so nobody buys a plant they could grow." };

export const Phone390: Story = { name: "390 px", decorators: [Phone] };
export const Wide1440: Story = { name: "1440 px", decorators: [Wide] };
export const Written390: Story = { name: "390 px · written", decorators: [Phone], args: { values: WRITTEN } };
export const Shaping390: Story = { name: "390 px · shaping", decorators: [Phone], args: { values: WRITTEN, busy: true } };
export const Failed390: Story = { name: "390 px · that did not go through", decorators: [Phone], args: { values: WRITTEN, error: "That did not go through. Try again." } };
