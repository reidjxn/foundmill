"use client";
import { forwardRef, useId, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "../../lib/cn";
import { Icon, type IconComponent } from "./Icon";

export const RadioGroup = forwardRef<ElementRef<typeof RadioGroupPrimitive.Root>, ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>>(
  function RadioGroup({ className, ...props }, ref) {
    return <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-2", className)} {...props} />;
  },
);

export type RadioGroupItemProps = ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>;

/**
 * 16 px circle (DESIGN §8): a well with a visible 1.5 px ring; selected is filled in the accent with an ink centre and a
 * glow. Arrow keys move between items; Space selects.
 */
export const RadioGroupItem = forwardRef<ElementRef<typeof RadioGroupPrimitive.Item>, RadioGroupItemProps>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "radio-dot peer inline-grid size-check shrink-0 place-items-center rounded-pill",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="radio-centre animate-pop" />
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

export interface RadioCardProps extends Omit<RadioGroupItemProps, "children"> {
  label: ReactNode;
  description?: ReactNode;
  /** A Lucide icon at the card's top right, in a small plate. */
  icon?: IconComponent;
}

/**
 * Radio card (DESIGN §8): the whole card is the target (it is the radio). At rest a 2 % plate with a hairline ring;
 * selected, an accent 10 % → 4 % fill, a 55 % ring, a 3 px halo and a glow, and the filled radio with its ink centre.
 * Named by its label (aria-labelledby) and described by its description, so `getByLabel("Full time")` finds it.
 */
export const RadioCard = forwardRef<ElementRef<typeof RadioGroupPrimitive.Item>, RadioCardProps>(function RadioCard(
  { id, label, description, icon, className, ...item },
  ref,
) {
  const auto = useId();
  const base = id ?? auto;
  const labelId = `${base}-label`;
  const descId = description ? `${base}-description` : undefined;
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      id={id}
      aria-labelledby={labelId}
      aria-describedby={descId}
      className={cn("radio-card group relative flex w-full cursor-pointer items-start gap-3 rounded-md px-3.5 py-3 text-left", className)}
      {...item}
    >
      <span aria-hidden className="radio-dot mt-px inline-grid size-check shrink-0 place-items-center rounded-pill" data-radio-dot="">
        <RadioGroupPrimitive.Indicator className="radio-centre animate-pop" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={labelId} className="text-chat font-medium text-primary">
          {label}
        </span>
        {description ? (
          <span id={descId} className="text-small text-tertiary transition-colors duration-hover group-data-[state=checked]:text-secondary">
            {description}
          </span>
        ) : null}
      </span>
      {icon ? (
        <span aria-hidden className="inline-grid size-control-xs shrink-0 place-items-center rounded-sm text-tertiary chip-plate border group-data-[state=checked]:text-accent">
          <Icon icon={icon} size="inline" />
        </span>
      ) : null}
    </RadioGroupPrimitive.Item>
  );
});
