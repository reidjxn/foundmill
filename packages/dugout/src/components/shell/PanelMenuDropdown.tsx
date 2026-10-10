/**
 * The panel's "…" menu: swap content, settings, Pin to Home, then the panel's own items after a separator. Loaded on
 * demand by PanelMenuButton (its own chunk), never imported statically: keep it out of the barrels.
 */
import type { ReactElement } from "react";
import { Pin, Replace, Settings2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../foundation/DropdownMenu";
import { Icon } from "../foundation/Icon";
import type { PanelMenu } from "./Panel";

export interface PanelMenuDropdownProps {
  menu: PanelMenu;
  /** The trigger button (PanelMenuButton draws it, so the plain and the live trigger are the same). */
  trigger: ReactElement;
  /** Open at once: the plain trigger was pressed before the menu's code arrived. */
  defaultOpen?: boolean;
}

export function PanelMenuDropdown({ menu, trigger, defaultOpen }: PanelMenuDropdownProps) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {menu.onSwap ? (
          <DropdownMenuItem onSelect={menu.onSwap}>
            <Icon icon={Replace} size="inline" className="text-secondary" />
            Swap content
          </DropdownMenuItem>
        ) : null}
        {menu.onSettings ? (
          <DropdownMenuItem onSelect={menu.onSettings}>
            <Icon icon={Settings2} size="inline" className="text-secondary" />
            Settings
          </DropdownMenuItem>
        ) : null}
        {menu.onPinToHome ? (
          <DropdownMenuItem onSelect={menu.onPinToHome}>
            <Icon icon={Pin} size="inline" className="text-secondary" />
            {menu.pinned ? "Unpin from Home" : "Pin to Home"}
          </DropdownMenuItem>
        ) : null}
        {menu.items && menu.items.length > 0 ? (
          <>
            {menu.onSwap || menu.onSettings || menu.onPinToHome ? <DropdownMenuSeparator /> : null}
            {menu.items.map((item) => (
              <DropdownMenuItem key={item.id} onSelect={item.onSelect} variant={item.variant} disabled={item.disabled}>
                {item.icon ? <Icon icon={item.icon} size="inline" className="text-secondary" /> : null}
                {item.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
