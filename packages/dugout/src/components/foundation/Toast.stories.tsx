import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { ToastProvider, useToast } from "./Toast";

const meta = {
  title: "Foundation/Toast",
  parameters: { docs: { description: { component: "Wrap the app in <ToastProvider>; call useToast().toast({...}) anywhere below. F8 focuses the stack; swipe right dismisses." } } },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function Demo() {
  const { toast, dismissAll } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast({ title: "Plan executed", description: "3 tasks created, 1 channel enabled.", tone: "good" })}>Good</Button>
      <Button onClick={() => toast({ title: "Runway under 9 months", description: "Finance lead has a recommendation in your Inbox.", tone: "warn" })}>Warn</Button>
      <Button onClick={() => toast({ title: "Agent session failed", description: "Scout hit a rate limit and will retry in 40 s.", tone: "bad", duration: Infinity })}>Bad (sticky)</Button>
      <Button onClick={() => toast({ title: "Cycle complete", tone: "info", action: { label: "Open Inbox", onClick: () => {} } })}>With action</Button>
      <Button variant="ghost" onClick={dismissAll}>
        Dismiss all
      </Button>
    </div>
  );
}

export const Playground: Story = { render: () => <Demo /> };
