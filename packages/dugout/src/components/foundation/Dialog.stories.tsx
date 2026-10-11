import type { Meta, StoryObj } from "@storybook/react-vite";
import { Square } from "lucide-react";
import { Button } from "./Button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./Dialog";

const meta = {
  title: "Foundation/Dialog",
  component: Dialog,
  parameters: {
    docs: {
      description: {
        component:
          "Glass on a 14 px radius with elev-3 over the canvas at 66% and a 6 px blur; it scales .98 → 1 from its center as it fades in. The header keeps a long title clear of the close button; the footer is a darker strip under a hairline. Esc closes; focus is trapped.",
      },
    },
  },
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

/** A long title wraps beside the close button, never under it. */
export const LongTitle: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button>Open</Button>
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete the Northwind Skincare retail partnership pipeline and its 14 saved views?</DialogTitle>
          <DialogDescription>Nothing is deleted until the scheduled job runs; the audit log records the request.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-secondary">You can cancel the request from Settings › Data until then.</p>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button variant="danger">Request deletion</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
};
