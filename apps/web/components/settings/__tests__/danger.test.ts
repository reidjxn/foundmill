import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJson } from "@/lib/download";
import { ARCHIVED_HREF, exportToast, saveExport } from "../danger";

const result = { fileName: "ledgerly-3f2a1c-export-2026-10-12.json", archive: { format: "foundmill-export/2", tables: { tasks: [{ id: "t1" }] } }, totalRows: 12_345, counts: { tasks: 12_000, agents: 345 }, complete: true };

describe("Danger zone export (BUILD §11.15)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("saves the archive the API returned as a JSON file under its file name", async () => {
    const created: Blob[] = [];
    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:export";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
    expect(saveExport(result)).toBe(true);
    expect(clicked).toEqual([{ download: result.fileName, href: "blob:export" }]);
    expect(created[0]!.type).toBe("application/json");
    expect(JSON.parse(await created[0]!.text())).toEqual(result.archive);
    expect(exportJson(result.archive)).toContain('\n  "format": "foundmill-export/2"');
  });

  it("says when the browser could not save it instead of claiming a download", () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(saveExport(result)).toBe(false);
    expect(exportToast(result, false)).toMatchObject({ tone: "info", title: "Export ready to save" });
    expect(exportToast(result, false).description).toContain("Save the file");
  });

  it("names the file and what it holds, and flags an incomplete archive", () => {
    expect(exportToast(result, true)).toEqual({ tone: "good", title: "Export downloaded", description: "ledgerly-3f2a1c-export-2026-10-12.json: 12,345 records across 2 tables. Credentials are never included." });
    expect(exportToast({ ...result, complete: false }, true).description).toMatch(/Not complete/);
    expect(ARCHIVED_HREF).toBe("/new#archived");
  });
});
