import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../foundation/Button";
import { Panel } from "../shell/Panel";
import { AdultCheck } from "./AdultCheck";

const meta = {
  title: "Guidance/AdultCheck",
  component: AdultCheck,
  parameters: {
    docs: {
      description: {
        component:
          "The one I am 18 or older box: the founder profile that creates an account, the one step a person from before sees once, and an invitation's Accept. The label is part of the 44 px tap target, so it works from 390 px. Controlled: the screen sends the confirmation with its own action.",
      },
    },
  },
  args: { checked: false, onCheckedChange: () => undefined, hint: "You confirm this once." },
} satisfies Meta<typeof AdultCheck>;
export default meta;
type Story = StoryObj<typeof meta>;

/** At rest, with its hint. */
export const Default: Story = {};

/** Ticked. */
export const Checked: Story = { args: { checked: true } };

/** The action was tried with the box empty. */
export const WithError: Story = { args: { error: "Confirm that you are 18 or older to continue." } };

/** The one step a person from before sees once, at 390 px. */
export const OneStep: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  render: function OneStep() {
    const [checked, setChecked] = useState(false);
    return (
      <div className="max-w-[390px] p-4">
        <Panel title="Before you continue">
          <div className="flex flex-col gap-3">
            <p className="text-body text-primary">This is for people 18 or older. Confirm it once and we won't ask again.</p>
            <AdultCheck checked={checked} onCheckedChange={setChecked} />
            <Button variant="primary" size="lg" className="min-h-tap" disabled={!checked}>
              Continue
            </Button>
          </div>
        </Panel>
      </div>
    );
  },
};
