"use client";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "../../lib/cn";

export const RadioGroup = forwardRef<ElementRef<typeof RadioGroupPrimitive.Root>, ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>>(
  function RadioGroup({ className, ...props }, ref) {
    return <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-2", className)} {...props} />;
  },
);

export type RadioGroupItemProps = ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>;

/** 16 px circle. Arrow keys move between items; Space selects. */
export const RadioGroupItem = forwardRef<ElementRef<typeof RadioGroupPrimitive.Item>, RadioGroupItemProps>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "peer inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-subtle bg-panel-alt",
        "transition-colors duration-micro ease-dugout hover:border-secondary/60",
        "data-[state=checked]:border-kit-primary disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="block size-2 rounded-full bg-kit-primary" />
    </RadioGroupPrimitive.Item>
  );
});

export interface RadioOptionProps extends RadioGroupItemProps {
  id: string;
  label: ReactNode;
  description?: ReactNode;
}

/** Item + label + optional description, laid out as a row. */
export function RadioOption({ id, label, description, className, ...item }: RadioOptionProps) {
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <RadioGroupItem id={id} className="mt-0.5" {...item} />
      <label htmlFor={id} className="flex cursor-pointer flex-col text-body text-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
        <span>{label}</span>
        {description ? <span className="text-small text-secondary">{description}</span> : null}
      </label>
    </div>
  );
}
