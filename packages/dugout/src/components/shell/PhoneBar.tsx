"use client";
import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, Search, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { BusinessLogo } from "../foundation/BusinessLogo";
import { Icon } from "../foundation/Icon";
import { ContinueButton, type ContinueButtonProps } from "./ContinueButton";
import { kitStyle } from "./KitBar";
import { ShellLink } from "./ShellLink";
import { StopAllAgents, type StopAllAgentsProps } from "./StopAllAgents";
import type { Kit, SidebarItem } from "./types";

/** The words on the menu button and the panel it opens (phone mode). */
export const PHONE_MENU_LABEL = "Menu";

export interface PhoneBarProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  kit: Kit;
  logoSrc?: string | null;
  logo?: ReactNode;
  businessName: string;
  continueButton: ContinueButtonProps;
  continueSlot?: ReactNode;
  stopAll: StopAllAgentsProps;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}

/**
 * The shell's top bar on a phone (CLAUDE.md "Small screens"): a menu button, the business's logo and name, and Continue
 * and Stop all agents at tap size. The shell draws the page's title on a thin row under it. No search chip, no runway or mode chips:
 * those are the console's, reached from the menu and the desktop.
 */
export const PhoneBar = forwardRef<HTMLDivElement, PhoneBarProps>(function PhoneBar(
  { kit, logoSrc, logo, businessName, continueButton, continueSlot, stopAll, menuOpen, onMenuOpenChange, className, style, ...rest },
  ref,
) {
  const logoNode = logo ?? <BusinessLogo src={logoSrc} name={businessName} primary={kit.primary} size={28} data-testid="phone-bar-logo" />;
  return (
    <div
      ref={ref}
      data-testid="phone-bar"
      data-coachmark="top-bar"
      className={cn("kitbar-slab z-10 flex h-kitbar shrink-0 items-center gap-2 px-2 text-kit-on-primary", className)}
      style={{ ...kitStyle(kit), ...style } as CSSProperties}
      {...rest}
    >
      <button
        type="button"
        aria-label={PHONE_MENU_LABEL}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        onClick={() => onMenuOpenChange(true)}
        className="inline-flex size-tap shrink-0 items-center justify-center rounded-sm text-kit-on-primary outline-none hover:bg-black/20 focus-visible:shadow-ring"
        data-testid="phone-menu-button"
      >
        <Icon icon={Menu} />
      </button>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex shrink-0">{logoNode}</span>
        <span className="t-display-sm min-w-0 truncate leading-tight" data-testid="phone-bar-name">
          {businessName}
        </span>
      </span>
      {continueSlot ? (
        <div className="flex min-h-tap shrink-0 items-stretch" data-testid="kitbar-continue-slot">
          {continueSlot}
        </div>
      ) : (
        <ContinueButton {...continueButton} className={cn("h-kitbar-chip min-h-tap rounded-track", continueButton.className)} />
      )}
      <StopAllAgents {...stopAll} className={cn("min-h-tap min-w-tap", stopAll.className)} />
    </div>
  );
});

export interface PhoneMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SidebarItem[];
  activeId?: string;
  businessName: string;
  onSelect: (item: SidebarItem) => void;
  onSearch?: () => void;
}

/**
 * The sidebar's items in a simple full-height panel (phone mode): the same items in the same order, as 44 px rows with
 * their badges. A focus trap and Esc come from the dialog it is made of; choosing an item closes it.
 */
export function PhoneMenu({ open, onOpenChange, items, activeId, businessName, onSelect, onSearch }: PhoneMenuProps) {
  const rows = items.filter((it) => !it.disabled);
  const choose = (item: SidebarItem) => {
    onOpenChange(false);
    onSelect(item);
  };
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="backdrop-motion fixed inset-0 z-50 bg-backdrop" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-testid="phone-menu"
          className="overlay-motion fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-line bg-panel text-body text-primary outline-none"
        >
          <div className="flex h-kitbar shrink-0 items-center justify-between gap-2 border-b border-line-faint pl-gutter pr-2">
            <DialogPrimitive.Title className="t-display-sm min-w-0 truncate text-primary">{businessName}</DialogPrimitive.Title>
            <DialogPrimitive.Close aria-label="Close menu" className="inline-flex size-tap shrink-0 items-center justify-center rounded-sm text-tertiary hover:text-primary focus-ring">
              <Icon icon={X} />
            </DialogPrimitive.Close>
          </div>
          <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto py-2" data-testid="phone-menu-nav">
            {onSearch ? (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onSearch();
                }}
                className="flex min-h-tap w-full items-center gap-3 px-gutter text-left text-secondary hover:bg-white/5 hover:text-primary focus-ring"
                data-testid="phone-menu-search"
              >
                <Icon icon={Search} />
                <span className="min-w-0 flex-1 truncate">Search</span>
              </button>
            ) : null}
            <ul className="flex flex-col">
              {rows.map((item) => {
                const active = item.id === activeId;
                const badge = item.badge && item.badge > 0 ? (item.badge > 99 ? "99+" : String(item.badge)) : null;
                const inner = (
                  <>
                    <Icon icon={item.icon} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {badge ? (
                      <span aria-hidden className={cn("sidebar-badge", item.badgeTone === "bad" && "tone-status-bad")} data-badge>
                        {badge}
                      </span>
                    ) : null}
                  </>
                );
                const cls = cn("flex min-h-tap w-full items-center gap-3 px-gutter text-left hover:bg-white/5 hover:text-primary focus-ring", active ? "bg-white/8 text-primary" : "text-secondary");
                const common = { "data-sidebar-item": item.id, "aria-current": active ? ("page" as const) : undefined, "aria-label": badge ? `${item.label}, ${item.badge} ${item.badge === 1 ? "item" : "items"}` : item.label, className: cls };
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <ShellLink href={item.href} onClick={() => choose(item)} {...common}>
                        {inner}
                      </ShellLink>
                    ) : (
                      <button type="button" onClick={() => choose(item)} {...common}>
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
