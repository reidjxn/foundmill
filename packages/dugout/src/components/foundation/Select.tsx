"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";
import { menuContentClass, menuItemClass, menuLabelClass, menuSeparatorClass } from "./menuStyles";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps extends ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  /** Height: sm 28, md 32 (default), lg 36, xl 46 (forms: a code chip and the name, Inter 500 13.5). */
  controlSize?: "sm" | "md" | "lg" | "xl";
  invalid?: boolean;
}

const TRIGGER_SIZE: Record<NonNullable<SelectTriggerProps["controlSize"]>, string> = {
  sm: "h-control-sm pl-2.5 pr-2",
  md: "h-control-md pl-2.5 pr-2",
  lg: "h-field pl-3 pr-2.5",
  xl: "h-field-lg rounded-track pl-3 pr-3 text-chat font-medium",
};

/** The trigger is a field (the well, DESIGN §8); its chevron turns over while the list is open. */
export const SelectTrigger = forwardRef<ElementRef<typeof SelectPrimitive.Trigger>, SelectTriggerProps>(function SelectTrigger(
  { className, children, controlSize = "md", invalid, ...props },
  ref,
) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      aria-invalid={invalid || undefined}
      data-size={controlSize}
      className={cn(
        "group field-well flex w-full min-w-0 items-center justify-between gap-2 rounded-sm text-body text-primary",
        "focus-visible:outline-none data-[placeholder]:text-tertiary disabled:cursor-not-allowed disabled:opacity-50",
        "[&>span]:min-w-0 [&>span]:truncate",
        TRIGGER_SIZE[controlSize],
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <Icon icon={ChevronDown} size="inline" className="text-tertiary transition-transform duration-overlay ease-out group-data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = forwardRef<ElementRef<typeof SelectPrimitive.Content>, ComponentPropsWithoutRef<typeof SelectPrimitive.Content>>(
  function SelectContent({ className, children, position = "popper", sideOffset = 4, ...props }, ref) {
    return (
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          position={position}
          sideOffset={sideOffset}
          className={cn(
            menuContentClass,
            "max-h-(--radix-select-content-available-height) min-w-32",
            position === "popper" && "w-full min-w-(--radix-select-trigger-width)",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-badge items-center justify-center text-tertiary">
            <Icon icon={ChevronUp} size="inline" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-0">{children}</SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-badge items-center justify-center text-tertiary">
            <Icon icon={ChevronDown} size="inline" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  },
);

export const SelectLabel = forwardRef<ElementRef<typeof SelectPrimitive.Label>, ComponentPropsWithoutRef<typeof SelectPrimitive.Label>>(
  function SelectLabel({ className, ...props }, ref) {
    return <SelectPrimitive.Label ref={ref} className={cn(menuLabelClass, className)} {...props} />;
  },
);

export const SelectItem = forwardRef<ElementRef<typeof SelectPrimitive.Item>, ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  function SelectItem({ className, children, ...props }, ref) {
    return (
      <SelectPrimitive.Item
        ref={ref}
        className={cn(menuItemClass, "w-full pr-8 data-[state=checked]:font-medium", className)}
        {...props}
      >
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex text-accent">
          <Icon icon={Check} size="inline" />
        </SelectPrimitive.ItemIndicator>
      </SelectPrimitive.Item>
    );
  },
);

export const SelectSeparator = forwardRef<ElementRef<typeof SelectPrimitive.Separator>, ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>>(
  function SelectSeparator({ className, ...props }, ref) {
    return <SelectPrimitive.Separator ref={ref} className={cn(menuSeparatorClass, className)} {...props} />;
  },
);

export interface SelectOption {
  value: string;
  label: ReactNode;
  /** A short code shown on a chip before the label, in the list and in the field ("GBP" · Pound sterling). */
  code?: string;
  disabled?: boolean;
  /** Text used for typeahead when label is not a string. */
  textValue?: string;
}

/** An ISO code or short id on a plate, before an option's name (the currency select). */
export function SelectCode({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("code-chip", className)}>{children}</span>;
}

/**
 * An option's content: the code chip (if any) and the label, inline, so a squeezed trigger ends the name with an
 * ellipsis instead of cutting it.
 */
export function SelectOptionLabel({ code, children }: { code?: string; children: ReactNode }) {
  if (!code) return <>{children}</>;
  return (
    <>
      <SelectCode className="mr-2 align-middle">{code}</SelectCode>
      {children}
    </>
  );
}

export interface SimpleSelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  controlSize?: SelectTriggerProps["controlSize"];
  id?: string;
  name?: string;
  required?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  className?: string;
  contentClassName?: string;
}

/** The common case: a flat list of options. For groups and custom items compose the parts above. */
export function SimpleSelect({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select…",
  disabled,
  invalid,
  controlSize,
  id,
  name,
  required,
  className,
  contentClassName,
  ...aria
}: SimpleSelectProps) {
  return (
    <Select value={value} defaultValue={defaultValue} onValueChange={onValueChange} disabled={disabled} name={name} required={required}>
      <SelectTrigger id={id} controlSize={controlSize} invalid={invalid} className={className} {...aria}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={contentClassName}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled} textValue={o.textValue ?? (o.code && typeof o.label === "string" ? `${o.code} ${o.label}` : undefined)}>
            <SelectOptionLabel code={o.code}>{o.label}</SelectOptionLabel>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
