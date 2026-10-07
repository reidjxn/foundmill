"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps extends ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  controlSize?: "sm" | "md";
  invalid?: boolean;
}

export const SelectTrigger = forwardRef<ElementRef<typeof SelectPrimitive.Trigger>, SelectTriggerProps>(function SelectTrigger(
  { className, children, controlSize = "md", invalid, ...props },
  ref,
) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-panel border border-subtle bg-panel-alt pl-2 pr-1.5 text-body text-primary",
        "transition-colors duration-micro ease-dugout hover:border-secondary/50 focus-visible:border-link focus-visible:outline-none",
        "data-[placeholder]:text-secondary disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-status-bad [&>span]:truncate",
        controlSize === "sm" ? "h-control-sm" : "h-control-md",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <Icon icon={ChevronDown} size="inline" className="text-secondary" />
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
            "surface-overlay z-50 max-h-(--radix-select-content-available-height) min-w-32 overflow-hidden p-1",
            position === "popper" && "w-full min-w-(--radix-select-trigger-width)",
            "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
            className,
          )}
          {...props}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-5 items-center justify-center text-secondary">
            <Icon icon={ChevronUp} size="inline" />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-0">{children}</SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-5 items-center justify-center text-secondary">
            <Icon icon={ChevronDown} size="inline" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    );
  },
);

export const SelectLabel = forwardRef<ElementRef<typeof SelectPrimitive.Label>, ComponentPropsWithoutRef<typeof SelectPrimitive.Label>>(
  function SelectLabel({ className, ...props }, ref) {
    return <SelectPrimitive.Label ref={ref} className={cn("t-label px-2 pb-1 pt-1.5", className)} {...props} />;
  },
);

export const SelectItem = forwardRef<ElementRef<typeof SelectPrimitive.Item>, ComponentPropsWithoutRef<typeof SelectPrimitive.Item>>(
  function SelectItem({ className, children, ...props }, ref) {
    return (
      <SelectPrimitive.Item
        ref={ref}
        className={cn(
          "relative flex h-row-compact w-full cursor-default select-none items-center rounded-chip pl-2 pr-7 text-body text-primary outline-none",
          "data-highlighted:bg-white/4 data-[state=checked]:text-primary data-disabled:pointer-events-none data-disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex text-link">
          <Icon icon={Check} size="inline" />
        </SelectPrimitive.ItemIndicator>
      </SelectPrimitive.Item>
    );
  },
);

export const SelectSeparator = forwardRef<ElementRef<typeof SelectPrimitive.Separator>, ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>>(
  function SelectSeparator({ className, ...props }, ref) {
    return <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-subtle", className)} {...props} />;
  },
);

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  /** Text used for typeahead when label is not a string. */
  textValue?: string;
}

export interface SimpleSelectProps {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  controlSize?: "sm" | "md";
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
          <SelectItem key={o.value} value={o.value} disabled={o.disabled} textValue={o.textValue}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
