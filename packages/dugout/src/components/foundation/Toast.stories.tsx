import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { Button } from "./Button";
import { ToastProvider, useToast, type ToastOptions } from "./Toast";

const meta = {
  title: "Foundation/Toast",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Wrap the app in <ToastProvider>; call useToast().toast({...}) anywhere below. The stack sits bottom left of the content column, clear of the sidebar, the DecisionBar, Continue and dialog footers. The newest toast is in front with a tone tile and a timer; older ones peek behind it and fan out on hover or focus (the timers pause). F8 focuses the stack; swipe left dismisses.",
      },
    },
  },
  decorators: [
    (Story) => (
      <ToastProvider>
        <div className="min-h-screen p-6">
          <Story />
        </div>
      </ToastProvider>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const SAMPLES: Record<string, ToastOptions> = {
  good: { title: "Plan executed", description: "3 tasks created, 1 channel enabled.", tone: "good" },
  warn: { title: "Runway under 9 months", description: "The Finance lead has a recommendation in your Inbox.", tone: "warn" },
  bad: { title: "Agent session failed", description: "Scout hit a rate limit and will retry in 40 s.", tone: "bad", duration: Infinity },
  info: { title: "Cycle complete", tone: "info", action: { label: "Open Inbox", onClick: () => {} } },
  neutral: { title: "Draft saved", description: "Version 4 of the Boots UK pitch." },
};

function Demo() {
  const { toast, dismissAll } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast(SAMPLES.good!)}>Good</Button>
      <Button onClick={() => toast(SAMPLES.warn!)}>Warn</Button>
      <Button onClick={() => toast(SAMPLES.bad!)}>Bad (sticky)</Button>
      <Button onClick={() => toast(SAMPLES.info!)}>With action</Button>
      <Button onClick={() => toast(SAMPLES.neutral!)}>Neutral</Button>
      <Button variant="ghost" onClick={dismissAll}>
        Dismiss all
      </Button>
    </div>
  );
}

export const Playground: Story = { render: () => <Demo /> };

function Stacked() {
  const { toast } = useToast();
  useEffect(() => {
    for (const k of ["neutral", "warn", "good"]) toast({ ...SAMPLES[k]!, duration: Infinity });
    // Fire once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <p className="text-small text-secondary">Three toasts stacked; hover the stack to fan them out.</p>;
}

/** Three toasts in the deck: the newest in front, two peeking behind. */
export const Stack: Story = { render: () => <Stacked /> };
