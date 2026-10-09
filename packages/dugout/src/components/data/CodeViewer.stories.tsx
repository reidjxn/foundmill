import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeViewer } from "./CodeViewer";

const SOURCE = `import { describe, expect, it } from "vitest";
import { matchTransactions } from "../src/matching";

/** Bank lines match ledger entries by amount, then by reference within 3 days. */
describe("matchTransactions", () => {
  it("matches on amount and reference", () => {
    const bank = [{ id: "b1", amountMinor: 12_500, ref: "INV-1042", on: "2026-10-01" }];
    const ledger = [{ id: "l1", amountMinor: 12_500, ref: "inv-1042", on: "2026-09-30" }];
    expect(matchTransactions(bank, ledger)).toEqual([{ bank: "b1", ledger: "l1" }]);
  });
});
`;

const meta = {
  title: "Data/CodeViewer",
  component: CodeViewer,
  parameters: { layout: "padded" },
  args: { path: "test/matching.test.ts", text: SOURCE, size: new TextEncoder().encode(SOURCE).byteLength },
  render: (args) => (
    <div style={{ height: 360, width: 860 }}>
      <CodeViewer {...args} className="h-full" />
    </div>
  ),
} satisfies Meta<typeof CodeViewer>;
export default meta;

type Story = StoryObj<typeof meta>;

export const SourceFile: Story = {};
export const Binary: Story = { args: { path: "public/logo.png", text: null, binary: true, size: 18_240 } };
export const Truncated: Story = { args: { path: "data/fixtures.json", text: '{\n  "rows": [\n', size: 3_400_000, truncated: true } };
export const Loading: Story = { args: { loading: true } };
