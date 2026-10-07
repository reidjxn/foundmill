/**
 * CSV export (BUILD §5.4 DataTable "CSV export"). Pure string building plus a tiny browser download helper.
 * RFC 4180: fields containing the delimiter, quotes or line breaks are quoted; quotes are doubled. A UTF-8 BOM is
 * prepended so spreadsheets open the file with the right encoding.
 */

export interface CsvColumn<T> {
  /** Header text. */
  header: string;
  /** Cell value for a row. Dates become ISO strings, numbers are written raw (no grouping), null/undefined empty. */
  value: (row: T) => unknown;
}

export interface CsvOptions {
  delimiter?: "," | ";" | "\t";
  /** Line ending. Default CRLF per RFC 4180. */
  newline?: "\r\n" | "\n";
  /** Prepend the UTF-8 byte-order mark (Excel). Default true for `downloadCsv`, false for `toCsv`. */
  bom?: boolean;
}

/** Format one value for a cell. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    if (
      "amountMinor" in (value as Record<string, unknown>) &&
      "currency" in (value as Record<string, unknown>)
    ) {
      const m = value as { amountMinor: number; currency: string };
      return `${(m.amountMinor / 100).toFixed(2)} ${m.currency}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/** Quote when needed. A leading `=`, `+`, `-`, `@` is prefixed with an apostrophe so a spreadsheet never executes it. */
export function escapeCsvCell(text: string, delimiter = ","): string {
  let t = text;
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  const needsQuotes =
    t.includes(delimiter) || t.includes('"') || t.includes("\n") || t.includes("\r");
  return needsQuotes ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Build CSV text from typed columns and rows. */
export function toCsv<T>(
  columns: readonly CsvColumn<T>[],
  rows: readonly T[],
  options: CsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ",";
  const nl = options.newline ?? "\r\n";
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsvCell(c.header, delimiter)).join(delimiter));
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvCell(csvCell(c.value(row)), delimiter)).join(delimiter));
  }
  const body = lines.join(nl) + nl;
  return options.bom ? `\uFEFF${body}` : body;
}

/** Safe file name: letters, digits, dash, underscore; always ends in .csv. */
export function csvFileName(name: string): string {
  const base = name
    .trim()
    .replace(/\.csv$/i, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "export"}.csv`;
}

/** Trigger a browser download. No-op outside a DOM. Returns true when a download was started. */
export function downloadCsv(
  fileName: string,
  csv: string,
  options: { bom?: boolean } = {},
): boolean {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  )
    return false;
  const text = options.bom === false || csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`;
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFileName(fileName);
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (typeof URL.revokeObjectURL === "function") setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

/** Build and download in one call. */
export function exportCsv<T>(
  fileName: string,
  columns: readonly CsvColumn<T>[],
  rows: readonly T[],
  options: CsvOptions = {},
): string {
  const csv = toCsv(columns, rows, { ...options, bom: false });
  downloadCsv(fileName, csv);
  return csv;
}
