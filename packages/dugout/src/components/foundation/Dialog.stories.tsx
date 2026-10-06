import type { Meta, StoryObj } from "@storybook/react-vite";
import { Square } from "lucide-react";
import { Button } from "./Button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./Dialog";

const meta = {
  title: "Foundation/Dialog",
  component: Dialog,
  parameters: { docs: { description: { component: "Backdrop rgba(15,19,24,0.72) with a 2 px blur; content on bg-panel-alt with the overlay shadow. Esc closes; focus is trapped." } } },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Confirm: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="danger" icon={Square}>
          Stop all agents
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Stop all agents?</DialogTitle>
          <DialogDescription>Running sessions end now. Nothing is merged or sent.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p>7 agents are working. Their progress is saved and each task returns to Ready.</p>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="danger">Stop all</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div className="flex gap-2">
      {(["sm", "md", "lg", "xl"] as const).map((s) => (
        <Dialog key={s}>
          <DialogTrigger asChild>
            <Button>{s}</Button>
          </DialogTrigger>
          <DialogContent size={s}>
            <DialogHeader>
              <DialogTitle>Dialog {s}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <p className="text-secondary">Body content.</p>
            </DialogBody>
          </DialogContent>
        </Dialog>
      ))}
    </div>
  ),
};
