import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Figure micro-typography (DESIGN §4, Mission "lg"): a formatted number split into its parts so the eye lands on the
 * digits. The currency symbol is dimmed and raised, money decimals and the scale suffix (K, M, %) are dimmed and
 * smaller, a unit ("mo", "/day") is set in mono text-3. The DOM text is the original string, so copy, search and
 * accessible names read "£4,255.57" unchanged. Server-safe: no hooks.
 *
 *   £72K       → <t-currency>£</> 72 <t-decimals>K</>
 *   £4,255.57  → <t-currency>£</> 4,255 <t-decimals>.57</>
 *   −£15K      → − <t-currency>£</> 15 <t-decimals>K</>   (a hyphen-minus is shown as a real minus)
 *   94%        → 94 <t-decimals>%</>
 */
export interface FigureParts {
  /** A leading sign ("−", "-" or "+"), kept at full size. */
  sign: string;
  /** Currency before the digits ("£", "SEK "). */
  currency: string;
  /** The integer digits with grouping ("4,255"). */
  int: string;
  /** Money decimals with their point (".57"); empty for non-money numbers, whose decimals are significant. */
  decimals: string;
  /** Whatever follows the digits: a scale suffix ("K", "%"), a unit or a trailing currency (" kr"). */
  rest: string;
}

const PATTERN = /^([−\-+]?)([^\d−\-+]*?)(\d[\d,\u00a0\u202f]*(?:\.\d+)?)(.*)$/u;

/** Split a formatted figure; null when it holds no digits ("—", "N/A"). Pure. */
export function figureParts(text: string): FigureParts | null {
  const m = PATTERN.exec(text);
  if (!m) return null;
  const [, sign = "", currency = "", num = "", rest = ""] = m;
  const isMoney = /[^\s\d]/.test(currency) || /^\s*(kr|zł|Kč|Ft|lei|лв)\b/u.test(rest);
  const dot = isMoney ? num.lastIndexOf(".") : -1;
  return {
    sign,
    currency,
    int: dot >= 0 ? num.slice(0, dot) : num,
    decimals: dot >= 0 ? num.slice(dot) : "",
    rest,
  };
}

/** A scale suffix or percent sign, dimmed at the decimals size; anything longer is a unit in mono. */
function isScaleSuffix(rest: string): boolean {
  return /^(?:[KMBT]|%|k|m|bn)$/u.test(rest.trim());
}

export interface FigureProps extends HTMLAttributes<HTMLSpanElement> {
  /** The formatted value ("£4,255.57", "94%", "20", "—"). */
  value: string;
  /** A unit after the figure in mono text-3 ("mo", "/day", "sections"). */
  unit?: ReactNode;
}

/**
 * A figure with Mission micro-typography. Size and colour come from the caller (`t-display-lg text-primary`); every
 * part scales with it in em.
 */
export function Figure({ value, unit, className, ...rest }: FigureProps) {
  const p = figureParts(value);
  return (
    <span className={cn("tabular whitespace-nowrap", className)} data-figure="" {...rest}>
      {p ? (
        <>
          {p.sign === "-" ? "−" : p.sign}
          {p.currency ? <span className="t-currency">{p.currency}</span> : null}
          {p.int}
          {p.decimals ? <span className="t-decimals">{p.decimals}</span> : null}
          {p.rest ? <span className={isScaleSuffix(p.rest) ? "t-decimals" : "t-unit"}>{p.rest}</span> : null}
        </>
      ) : (
        value
      )}
      {unit ? <span className="t-unit">{unit}</span> : null}
    </span>
  );
}
