"use client";
import { forwardRef, useRef, useState, type ChangeEvent, type FocusEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { DEFAULT_LOCALE, currencySymbol, formatMoneyInput } from "../../lib/format";
import { Input, type InputProps, type InputSize } from "./Input";

export interface MoneyInputProps extends Omit<InputProps, "prefix" | "suffix" | "suffixVariant" | "numeric" | "mono" | "value" | "defaultValue" | "type" | "controlSize"> {
  /** The raw text as typed ("60000", "25k", "60,000"). The caller parses it; the field only changes how it looks at rest. */
  value?: string;
  defaultValue?: string;
  /** The raw text on every keystroke (alongside the native `onChange`). */
  onValueChange?: (raw: string) => void;
  /** ISO 4217 code, shown as its own segment after the value ("GBP"). */
  currency?: string;
  /** The symbol before the value. Default: the currency's narrow symbol in `locale` ("£"); false for none. */
  symbol?: ReactNode | false;
  /** Grouping and the symbol follow this locale. Default en-GB. */
  locale?: string;
  /** md 32 (a toolbar or table), lg 36, xl 46 (forms; the default): the value in Barlow 600 22 with the symbol at 18. */
  controlSize?: Exclude<InputSize, "sm">;
}

/**
 * MoneyInput (DESIGN §8): [symbol] [amount] … | CODE. Built on Input's flow layout, so the symbol, the amount and the
 * code segment can never overlap. While the field has focus it shows exactly what was typed; at rest it shows the
 * amount grouped for the locale ("60000" → "60,000", "25k" → "25,000"). The caller's value is always the raw text, so
 * parsers that accept "25k" keep working.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, defaultValue, onChange, onValueChange, onFocus, onBlur, onPointerDown, currency, symbol, locale = DEFAULT_LOCALE, controlSize = "xl", className, prefixClassName, inputMode, ...rest },
  ref,
) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const [focused, setFocused] = useState(false);
  const pointer = useRef(false);
  const raw = value ?? own;
  const shown = focused ? raw : formatMoneyInput(raw, locale);
  const sym = symbol === false ? null : (symbol ?? currencySymbol(currency, locale) ?? null);
  const big = controlSize === "xl";
  return (
    <Input
      ref={ref}
      type="text"
      inputMode={inputMode ?? "decimal"}
      autoComplete="off"
      {...rest}
      value={shown}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        if (value === undefined) setOwn(e.target.value);
        onChange?.(e);
        onValueChange?.(e.target.value);
      }}
      onPointerDown={(e: PointerEvent<HTMLInputElement>) => {
        pointer.current = true;
        onPointerDown?.(e);
      }}
      onFocus={(e: FocusEvent<HTMLInputElement>) => {
        // Swap to the raw text now, inside the focus event (left to the re-render, the swap would land after any
        // selection and the next keystroke would append). Focus from the keyboard or from code selects the amount, so
        // typing replaces it, as tabbing into a plain field does; a click keeps its caret.
        const el = e.currentTarget;
        if (el.value !== raw) {
          el.value = raw;
          if (!pointer.current) el.select();
        }
        pointer.current = false;
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e: FocusEvent<HTMLInputElement>) => {
        setFocused(false);
        onBlur?.(e);
      }}
      controlSize={controlSize}
      prefix={sym ?? undefined}
      prefixClassName={cn(big && "font-display font-semibold text-money-symbol", prefixClassName)}
      suffix={currency ? currency.toUpperCase() : undefined}
      suffixVariant="segment"
      className={cn("tabular-nums", big && "font-display font-semibold text-money tracking-wide", className)}
      data-money-input=""
    />
  );
});
