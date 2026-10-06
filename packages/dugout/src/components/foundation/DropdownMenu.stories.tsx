import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown, Download, Pin, Replace, Settings } from "lucide-react";
import { Button } from "./Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import { Icon } from "./Icon";

const meta = { title: "Foundation/DropdownMenu", component: DropdownMenu } satisfies Meta<typeof DropdownMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PanelCaretMenu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" iconRight={ChevronDown}>
          Panel
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Runway</DropdownMenuLabel>
        <DropdownMenuItem>
          <Icon icon={Replace} size="inline" /> Swap content
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Icon icon={Settings} size="inline" /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem>
          <Icon icon={Pin} size="inline" /> Pin to Home <DropdownMenuShortcut>P</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>
              <Icon icon={Download} size="inline" /> CSV
            </DropdownMenuItem>
            <DropdownMenuItem>PNG</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Density</DropdownMenuLabel>
        <DropdownMenuRadioGroup value="compact">
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked>Show forecast</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger">Remove from screen</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
