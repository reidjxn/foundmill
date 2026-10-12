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
  /** Grouping and the symbol follow this locale. Default en-US. */
  locale?: string;
  /** md 32 (a toolbar or table), lg 36, xl 46 (forms; the default): the value in Barlow 600 22 with the symbol at 18. */
  controlSize?: Exclude<InputSize, "sm">;
}

/** The group separators of a locale's numbers ("," in en-US, "." in de-DE, narrow spaces in fr-FR) and its decimal mark. */
function numberMarks(locale: string): { group: string; decimal: string } {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
    return { group: parts.find((p) => p.type === "group")?.value ?? ",", decimal: parts.find((p) => p.type === "decimal")?.value ?? "." };
  } catch {
    return { group: ",", decimal: "." };
  }
}

/**
 * Where a caret placed in the grouped text at rest belongs in the raw text the focused field shows: after the same
 * characters, group separators not counted ("12,0|00" → "120|00"; "1,205,|001" → "1205|001"). When the two are not the
 * same number written two ways (a shorthand such as "25k" shows as "25,000"), the caret goes to the end. Exported for tests.
 */
export function rawCaret(shown: string, raw: string, index: number, locale: string = DEFAULT_LOCALE): number {
  const { group, decimal } = numberMarks(locale);
  const isGroup = (c: string) => c === group || /\s/.test(c);
  const shownKey = Array.from(shown)
    .filter((c) => !isGroup(c))
    .map((c) => (c === decimal ? "." : c))
    .join("");
  const rawGroup = (c: string) => c === "," || c === "'" || /\s/.test(c);
  const rawKey = Array.from(raw.trim())
    .filter((c) => !rawGroup(c))
    .join("");
  if (shownKey !== rawKey) return raw.length;
  let wanted = Array.from(shown.slice(0, Math.max(0, index))).filter((c) => !isGroup(c)).length;
  const lead = raw.length - raw.trimStart().length;
  let i = lead;
  while (wanted > 0 && i < raw.length) {
    if (!rawGroup(raw[i] as string)) wanted--;
    i++;
  }
  // A caret just after a separator stays after the raw text's own separator, when it typed one.
  if (index > 0 && isGroup(shown[index - 1] as string)) while (i < raw.length && rawGroup(raw[i] as string)) i++;
  return i;
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
        const el = e.currentTarget;
        if (pointer.current && el.value !== raw) {
          // A click: the browser places its caret in the grouped text just after this event, by where the pointer is.
          // Swapping now would reflow the text under the pointer first (each removed separator shifting the digits
          // left), so the caret would land a digit or more off. Swap once the caret is placed, and keep it beside the
          // same digit.
          pointer.current = false;
          const grouped = el.value;
          window.setTimeout(() => {
            if (document.activeElement !== el || el.value !== grouped) return;
            const start = el.selectionStart ?? grouped.length;
            const end = el.selectionEnd ?? start;
            el.value = raw;
            el.setSelectionRange(rawCaret(grouped, raw, start, locale), rawCaret(grouped, raw, end, locale));
            setFocused(true);
          }, 0);
          onFocus?.(e);
          return;
        }
        // Swap to the raw text now, inside the focus event (left to the re-render, the swap would land after any
        // selection and the next keystroke would append). Focus from the keyboard or from code selects the amount, so
        // typing replaces it, as tabbing into a plain field does.
        if (el.value !== raw) {
          el.value = raw;
          el.select();
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
