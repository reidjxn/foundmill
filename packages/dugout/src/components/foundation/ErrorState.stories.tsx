import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorState } from "./ErrorState";

const meta = {
  title: "Foundation/ErrorState",
  component: ErrorState,
  args: { children: "Could not load the attribution model." },
} satisfies Meta<typeof ErrorState>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithRetry: Story = { args: { onRetry: () => {}, label: "Failed" } };
export const WithDetail: Story = {
  args: { onRetry: () => {}, detail: "TRPCClientError: UNAUTHORIZED\n  at journey.attribution (routers/journey.ts:42)" },
};
