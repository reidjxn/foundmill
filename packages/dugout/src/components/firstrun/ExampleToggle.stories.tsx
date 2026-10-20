import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "../foundation/Input";
import { Field } from "../foundation/Label";
import { Textarea } from "../foundation/Textarea";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
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
          "A ghost Show me an example that swaps a panel body or a form value for a labeled example: the neutral Example chip inside a dashed edge (dashed never means measured). Hide the example puts it back. Guidance off: not rendered.",
      },
    },
  },
  decorators: [
    (Story) => (
      <PageGrid flush>
        <Panel title="The brief" span={6}>
          <Story />
        </Panel>
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

export const PanelBody: Story = {};

export const Shown: Story = { args: { defaultShown: true } };

/** A form that swaps its own values through the render-prop and frames them itself. */
export const FormValues: Story = {
  args: { example: undefined },
  render: (args) => (
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
  ),
};

export const GuidanceOff: Story = {
  render: (args) => (
    <GuidanceProvider value={{ guidance: "off" }}>
      <ExampleToggle {...args} defaultShown />
      <p className="text-small text-tertiary">Guidance is off: no toggle, no example.</p>
    </GuidanceProvider>
  ),
};
