import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { Input } from "./Input";
import { Field } from "./Label";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "./Popover";

const meta = { title: "Foundation/Popover", component: Popover } satisfies Meta<typeof Popover>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SavedView: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">Save view</Button>
      </PopoverTrigger>
      <PopoverContent>
        <Field htmlFor="view" label="View name">
          <Input id="view" placeholder="Hot leads this week" autoFocus />
        </Field>
        <div className="mt-3 flex justify-end gap-2">
          <PopoverClose asChild>
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
          </PopoverClose>
          <PopoverClose asChild>
            <Button size="sm" variant="primary">
              Save
            </Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  ),
};
