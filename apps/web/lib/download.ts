/**
 * Hand a file the page already holds (a business export, a CRM record export) to the browser to save. Returns false
 * where object URLs are unavailable (server render, tests, a locked-down browser) so the caller can say so instead of
 * claiming a download that never happened.
 */
export function downloadText(fileName: string, text: string, mime = "application/json"): boolean {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function" || typeof Blob === "undefined") return false;
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** The business export's file: pretty-printed JSON, so it reads in any editor. */
export function exportJson(archive: unknown): string {
  return `${JSON.stringify(archive, null, 2)}\n`;
}
