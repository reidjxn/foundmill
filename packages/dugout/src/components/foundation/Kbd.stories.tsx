import type { Meta, StoryObj } from "@storybook/react-vite";
import { Kbd, Keys } from "./Kbd";

const meta = { title: "Foundation/Kbd", component: Kbd, args: { children: "Space" } } satisfies Meta<typeof Kbd>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** 20 px, as in quick replies (a digit before the reply). */
export const Medium: Story = { args: { size: "md", children: "1" } };
export const KeyboardMap: Story = {
  render: () => (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
      <dt>
        <Kbd>Space</Kbd>
      </dt>
      <dd className="text-secondary">Continue</dd>
      <dt>
        <Kbd>R</Kbd>
      </dt>
      <dd className="text-secondary">Refresh Inbox</dd>
      <dt>
        <Keys keys={["G", "H"]} />
      </dt>
      <dd className="text-secondary">Go to Today</dd>
      <dt>
        <Kbd>⌘K</Kbd>
      </dt>
      <dd className="text-secondary">Search</dd>
      <dt>
        <span className="inline-flex gap-1">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
        </span>
      </dt>
      <dd className="text-secondary">Next / previous inbox item</dd>
    </dl>
  ),
};
