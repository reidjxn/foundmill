import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "./ContextMenu";

const meta = { title: "Foundation/ContextMenu", component: ContextMenu } satisfies Meta<typeof ContextMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EntityVerbs: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="surface-panel flex h-row-comfortable w-96 items-center px-3 text-body text-secondary">Right-click this row</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>Ada Lovelace</ContextMenuLabel>
        <ContextMenuItem>
          Message <ContextMenuShortcut>M</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>Assign agent</ContextMenuItem>
        <ContextMenuItem>Add to list</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>
          Open profile <ContextMenuShortcut>↵</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
};
