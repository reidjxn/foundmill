"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";
import {
  menuCheckItemClass,
  menuContentClass,
  menuIndicatorClass,
  menuItemClass,
  menuLabelClass,
  menuSeparatorClass,
  menuShortcutClass,
  menuSubChevronClass,
  menuSubTriggerClass,
} from "./menuStyles";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuPortal = Menu.Portal;
export const DropdownMenuSub = Menu.Sub;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export const DropdownMenuContent = forwardRef<ElementRef<typeof Menu.Content>, ComponentPropsWithoutRef<typeof Menu.Content>>(function DropdownMenuContent(
  { className, sideOffset = 6, align = "start", collisionPadding = 8, ...props },
  ref,
) {
  return (
    <Menu.Portal>
      <Menu.Content ref={ref} sideOffset={sideOffset} align={align} collisionPadding={collisionPadding} className={cn(menuContentClass, className)} {...props} />
    </Menu.Portal>
  );
});

export const DropdownMenuSubContent = forwardRef<ElementRef<typeof Menu.SubContent>, ComponentPropsWithoutRef<typeof Menu.SubContent>>(
  function DropdownMenuSubContent({ className, sideOffset = 4, alignOffset = -6, ...props }, ref) {
    return (
      <Menu.Portal>
        <Menu.SubContent ref={ref} sideOffset={sideOffset} alignOffset={alignOffset} className={cn(menuContentClass, className)} {...props} />
      </Menu.Portal>
    );
  },
);

export interface DropdownMenuItemProps extends ComponentPropsWithoutRef<typeof Menu.Item> {
  variant?: "default" | "danger";
  inset?: boolean;
}

export const DropdownMenuItem = forwardRef<ElementRef<typeof Menu.Item>, DropdownMenuItemProps>(function DropdownMenuItem(
  { className, variant = "default", inset, ...props },
  ref,
) {
  return <Menu.Item ref={ref} data-variant={variant} className={cn(menuItemClass, inset && "pl-8", className)} {...props} />;
});

export const DropdownMenuCheckboxItem = forwardRef<ElementRef<typeof Menu.CheckboxItem>, ComponentPropsWithoutRef<typeof Menu.CheckboxItem>>(
  function DropdownMenuCheckboxItem({ className, children, ...props }, ref) {
    return (
      <Menu.CheckboxItem ref={ref} className={cn(menuCheckItemClass, className)} {...props}>
        <Menu.ItemIndicator className={menuIndicatorClass}>
          <Icon icon={Check} size="inline" strokeWidth={2.25} />
        </Menu.ItemIndicator>
        {children}
      </Menu.CheckboxItem>
    );
  },
);

export const DropdownMenuRadioItem = forwardRef<ElementRef<typeof Menu.RadioItem>, ComponentPropsWithoutRef<typeof Menu.RadioItem>>(
  function DropdownMenuRadioItem({ className, children, ...props }, ref) {
    return (
      <Menu.RadioItem ref={ref} className={cn(menuCheckItemClass, className)} {...props}>
        <Menu.ItemIndicator className={menuIndicatorClass}>
          <Icon icon={Circle} size={7} fill="currentColor" />
        </Menu.ItemIndicator>
        {children}
      </Menu.RadioItem>
    );
  },
);

export const DropdownMenuSubTrigger = forwardRef<ElementRef<typeof Menu.SubTrigger>, ComponentPropsWithoutRef<typeof Menu.SubTrigger> & { inset?: boolean }>(
  function DropdownMenuSubTrigger({ className, inset, children, ...props }, ref) {
    return (
      <Menu.SubTrigger ref={ref} className={cn(menuSubTriggerClass, inset && "pl-8", className)} {...props}>
        {children}
        <Icon icon={ChevronRight} size="inline" className={menuSubChevronClass} />
      </Menu.SubTrigger>
    );
  },
);

export const DropdownMenuLabel = forwardRef<ElementRef<typeof Menu.Label>, ComponentPropsWithoutRef<typeof Menu.Label>>(function DropdownMenuLabel(
  { className, ...props },
  ref,
) {
  return <Menu.Label ref={ref} className={cn(menuLabelClass, className)} {...props} />;
});

export const DropdownMenuSeparator = forwardRef<ElementRef<typeof Menu.Separator>, ComponentPropsWithoutRef<typeof Menu.Separator>>(
  function DropdownMenuSeparator({ className, ...props }, ref) {
    return <Menu.Separator ref={ref} className={cn(menuSeparatorClass, className)} {...props} />;
  },
);

export function DropdownMenuShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(menuShortcutClass, className)} {...props} />;
}
