/**
 * Pure helpers shared by Settings › Danger zone and Your businesses › Archived businesses (BUILD §11.15): saving the
 * `business.export` archive as a file and the words that say what it holds.
 */
import { downloadText, exportJson } from "@/lib/download";
import { formatNumber } from "@/lib/format";

export const DELETION_DELAY_DAYS = 7;
/** Where an archived business is listed for its owner (Restore, Export everything, Delete permanently): Your businesses. */
export const ARCHIVED_HREF = "/businesses#archived";

/** What `business.export` returns that the page needs to save the file and say what it holds. */
export interface ExportedArchive {
  fileName: string;
  archive: unknown;
  totalRows: number;
  counts: Record<string, number>;
  complete: boolean;
}

/** The toast after an export: the file name and what it holds, or that the browser has not saved it yet. */
export function exportToast(result: ExportedArchive, saved: boolean): { tone: "good" | "info"; title: string; description: string } {
  const tables = Object.keys(result.counts).length;
  const holds = `${formatNumber(result.totalRows)} records across ${tables} tables`;
  const cut = result.complete ? "" : " Not complete: the Inbox note names the tables that stopped early.";
  if (!saved) return { tone: "info", title: "Export ready to save", description: `Your browser did not save ${result.fileName} (${holds}). Press Save the file to try again.${cut}` };
  return { tone: "good", title: "Export downloaded", description: `${result.fileName}: ${holds}. Credentials are never included.${cut}` };
}

/** Save the export as a file; true when the browser took it. */
export function saveExport(result: Pick<ExportedArchive, "fileName" | "archive">): boolean {
  return downloadText(result.fileName, exportJson(result.archive));
}
