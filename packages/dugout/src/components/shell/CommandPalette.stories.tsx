import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { Kbd } from "../foundation/Kbd";
import { CommandPalette, filterPaletteItems, parseSearchQuery, type PaletteItem } from "./CommandPalette";
import { PALETTE_ITEMS, RECENT_PALETTE_ITEMS } from "./fixtures";

const meta = {
  title: "Shell/CommandPalette",
  component: CommandPalette,
  parameters: { docs: { description: { component: "Universal search (BUILD §11.12) on cmdk: results grouped by kind with icons, operators kind:/role:/stage:/owner:/department: and > for commands, a hint row, ↑↓ ↵ Esc. Opens from the top bar, / or ⌘K." } } },
  args: { open: true, onOpenChange: () => {}, items: PALETTE_ITEMS, recent: RECENT_PALETTE_ITEMS, onSelect: () => {} },
} satisfies Meta<typeof CommandPalette>;
export default meta;
type Story = StoryObj<typeof meta>;

function Frame(args: Story["args"]) {
  const [open, setOpen] = useState(args?.open ?? false);
  const [last, setLast] = useState<PaletteItem | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button onClick={() => setOpen(true)}>Open search</Button>
        <span className="text-small text-secondary">
          or press <Kbd>/</Kbd>
        </span>
      </div>
      {last ? (
        <p className="text-small text-secondary">
          Selected: {last.kind} · {last.label}
        </p>
      ) : null}
      <CommandPalette {...args} items={args?.items ?? []} onSelect={(it) => setLast(it)} open={open} onOpenChange={setOpen} />
    </div>
  );
}

export const Open: Story = { render: (args) => <Frame {...args} /> };
export const Closed: Story = { args: { open: false }, render: (args) => <Frame {...args} /> };
export const CommandsOnly: Story = { args: { query: "> " } };
export const KindFilter: Story = { name: "kind:person", args: { query: "kind:person" } };
export const Loading: Story = { args: { loading: true, items: [], recent: [] } };
export const Empty: Story = { args: { query: "qwertyuiop", recent: [] } };
function RemoteFrame(args: Story["args"]) {
  const [query, setQuery] = useState("");
    const [items, setItems] = useState<PaletteItem[]>(PALETTE_ITEMS);
    const [loading, setLoading] = useState(false);
    return (
      <CommandPalette
        {...args}
        onSelect={args?.onSelect ?? (() => {})}
        onOpenChange={args?.onOpenChange ?? (() => {})}
        open={args?.open ?? true}
        items={items}
        remote
        loading={loading}
        query={query}
        onQueryChange={(raw) => {
          setQuery(raw);
          setLoading(true);
          // Simulates the hybrid search round trip (p95 < 150 ms target).
          setTimeout(() => {
            setItems(filterPaletteItems(PALETTE_ITEMS, parseSearchQuery(raw)));
            setLoading(false);
          }, 120);
        }}
      />
    );
}

export const RemoteSearch: Story = { name: "Remote (app-driven) results", render: (args) => <RemoteFrame {...args} /> };
