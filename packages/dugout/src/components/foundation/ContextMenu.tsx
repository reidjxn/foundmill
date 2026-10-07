"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type HTMLAttributes } from "react";
import * as Menu from "@radix-ui/react-context-menu";
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
  menuSubTriggerClass,
} from "./menuStyles";

export const ContextMenu = Menu.Root;
export const ContextMenuTrigger = Menu.Trigger;
export const ContextMenuGroup = Menu.Group;
export const ContextMenuPortal = Menu.Portal;
export const ContextMenuSub = Menu.Sub;
export const ContextMenuRadioGroup = Menu.RadioGroup;

export const ContextMenuContent = forwardRef<ElementRef<typeof Menu.Content>, ComponentPropsWithoutRef<typeof Menu.Content>>(function ContextMenuContent(
  { className, collisionPadding = 8, ...props },
  ref,
) {
  return (
    <Menu.Portal>
      <Menu.Content ref={ref} collisionPadding={collisionPadding} className={cn(menuContentClass, className)} {...props} />
    </Menu.Portal>
  );
});

export const ContextMenuSubContent = forwardRef<ElementRef<typeof Menu.SubContent>, ComponentPropsWithoutRef<typeof Menu.SubContent>>(
  function ContextMenuSubContent({ className, sideOffset = 2, ...props }, ref) {
    return (
      <Menu.Portal>
        <Menu.SubContent ref={ref} sideOffset={sideOffset} className={cn(menuContentClass, className)} {...props} />
      </Menu.Portal>
    );
  },
);

export interface ContextMenuItemProps extends ComponentPropsWithoutRef<typeof Menu.Item> {
  variant?: "default" | "danger";
  inset?: boolean;
}

export const ContextMenuItem = forwardRef<ElementRef<typeof Menu.Item>, ContextMenuItemProps>(function ContextMenuItem(
  { className, variant = "default", inset, ...props },
  ref,
) {
  return <Menu.Item ref={ref} data-variant={variant} className={cn(menuItemClass, inset && "pl-7", className)} {...props} />;
});

export const ContextMenuCheckboxItem = forwardRef<ElementRef<typeof Menu.CheckboxItem>, ComponentPropsWithoutRef<typeof Menu.CheckboxItem>>(
  function ContextMenuCheckboxItem({ className, children, ...props }, ref) {
    return (
      <Menu.CheckboxItem ref={ref} className={cn(menuCheckItemClass, className)} {...props}>
        <Menu.ItemIndicator className={menuIndicatorClass}>
          <Icon icon={Check} size={12} strokeWidth={2.25} />
        </Menu.ItemIndicator>
        {children}
      </Menu.CheckboxItem>
    );
  },
);

export const ContextMenuRadioItem = forwardRef<ElementRef<typeof Menu.RadioItem>, ComponentPropsWithoutRef<typeof Menu.RadioItem>>(
  function ContextMenuRadioItem({ className, children, ...props }, ref) {
    return (
      <Menu.RadioItem ref={ref} className={cn(menuCheckItemClass, className)} {...props}>
        <Menu.ItemIndicator className={menuIndicatorClass}>
          <Icon icon={Circle} size={8} fill="currentColor" />
        </Menu.ItemIndicator>
        {children}
      </Menu.RadioItem>
    );
  },
);

export const ContextMenuSubTrigger = forwardRef<ElementRef<typeof Menu.SubTrigger>, ComponentPropsWithoutRef<typeof Menu.SubTrigger> & { inset?: boolean }>(
  function ContextMenuSubTrigger({ className, inset, children, ...props }, ref) {
    return (
      <Menu.SubTrigger ref={ref} className={cn(menuSubTriggerClass, inset && "pl-7", className)} {...props}>
        {children}
        <Icon icon={ChevronRight} size="inline" className="ml-auto text-secondary" />
      </Menu.SubTrigger>
    );
  },
);

export const ContextMenuLabel = forwardRef<ElementRef<typeof Menu.Label>, ComponentPropsWithoutRef<typeof Menu.Label>>(function ContextMenuLabel(
  { className, ...props },
  ref,
) {
  return <Menu.Label ref={ref} className={cn(menuLabelClass, className)} {...props} />;
});

export const ContextMenuSeparator = forwardRef<ElementRef<typeof Menu.Separator>, ComponentPropsWithoutRef<typeof Menu.Separator>>(
  function ContextMenuSeparator({ className, ...props }, ref) {
    return <Menu.Separator ref={ref} className={cn(menuSeparatorClass, className)} {...props} />;
  },
);

export function ContextMenuShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn(menuShortcutClass, className)} {...props} />;
}
