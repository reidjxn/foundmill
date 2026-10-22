import "./setup";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@foundmill/dugout";
import { VisionScreen } from "../VisionScreen";
import { importSummary, previewRows, readPlanFile, type PlanPreviewData } from "../plan/PlanImportDialog";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses } from "./fixtures";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const PLAN = "# Specification\n## Problem\nRefills are tracked by hand.\n# Roadmap\n## Now\n### Refill reminders\n";
const file = (content: string | Uint8Array, name: string) => new File([content as BlobPart], name, { type: "text/markdown" });
const PREVIEW: PlanPreviewData = { ok: true, errors: [], vision: false, sections: { write: ["Problem"], create: ["Go to market"], paragraphsRetired: 0 }, roadmap: { now: 1, next: 0, later: 2 }, archive: 0 };
const RESULT = { sectionsWritten: ["Problem"], sectionsCreated: ["Go to market"], paragraphsRetired: 0, itemsAdded: { now: 1, next: 0, later: 2 }, itemsArchived: 3, visionSet: false };

function render(role: string, onMutate?: (path: string, input: Record<string, unknown>) => unknown, canWrite = true) {
  const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "business.get": { role } }, onMutate });
  renderScreen(
    fake,
    <ToastProvider>
      <VisionScreen businessId={BID} departmentId="d1" />
    </ToastProvider>,
    { canWrite: () => canWrite },
  );
  return fake;
}

describe("readPlanFile", () => {
  it("accepts a UTF-8 .md file and refuses other types, empty, oversized and non-UTF-8 files", async () => {
    expect(await readPlanFile(file(PLAN, "plan.md"))).toEqual({ ok: true, fileName: "plan.md", text: PLAN });
    expect(await readPlanFile(file(PLAN, "plan.markdown"))).toMatchObject({ ok: true });
    expect(await readPlanFile(file(PLAN, "plan.txt"))).toEqual({ ok: false, message: "Choose a Markdown file (.md)." });
    expect(await readPlanFile(file("", "plan.md"))).toEqual({ ok: false, message: "The file is empty." });
    expect(await readPlanFile(file("x".repeat(256 * 1024 + 1), "plan.md"))).toEqual({ ok: false, message: expect.stringMatching(/larger than 256 KB/) });
    expect(await readPlanFile(file(new Uint8Array([0x23, 0x20, 0xff, 0xfe]), "plan.md"))).toEqual({ ok: false, message: expect.stringMatching(/not valid UTF-8/) });
  });

  it("words the preview and the result", () => {
    expect(previewRows(PREVIEW, false)).toEqual([
      { label: "Vision", value: "Not in this file" },
      { label: "Sections to rewrite", value: "1: Problem" },
      { label: "Sections to add", value: "1: Go to market" },
      { label: "Roadmap items to add", value: "Now 1 · Next 0 · Later 2" },
    ]);
    expect(previewRows({ ...PREVIEW, archive: 4 }, true).at(-1)).toEqual({ label: "Unstarted items to retire", value: "4" });
    expect(importSummary(RESULT)).toBe("1 section rewritten, 1 section added, 3 roadmap items added, 3 unstarted items retired.");
    expect(importSummary({ ...RESULT, visionSet: true, sectionsWritten: [], sectionsCreated: [], itemsAdded: { now: 0, next: 0, later: 0 }, itemsArchived: 0 })).toBe("Vision updated.");
  });
});

describe("Import a plan on the Vision tab", () => {
  it("is offered to owners and admins only", async () => {
    render("owner");
    expect(await screen.findByTestId("plan-import-open")).toBeTruthy();
  });

  it("is not offered to members", () => {
    render("member");
    expect(screen.queryByTestId("plan-import-open")).toBeNull();
  });

  it("is not offered without product write, whatever the role", () => {
    render("admin", undefined, false);
    expect(screen.queryByTestId("plan-import-open")).toBeNull();
  });

  it("previews the chosen file, previews again when retiring is turned on, imports, toasts and refetches", async () => {
    const user = userEvent.setup();
    const fake = render("admin", (path, input) => (path === "product.plan.preview" ? { ...PREVIEW, archive: input.replaceUnstarted ? 3 : 0 } : RESULT));
    await user.click(await screen.findByTestId("plan-import-open"));
    const dialog = await screen.findByTestId("plan-import-dialog");
    expect((within(dialog).getByTestId("plan-import-submit") as HTMLButtonElement).disabled).toBe(true);

    await user.upload(within(dialog).getByTestId("plan-file-input"), file(PLAN, "plan.md"));
    const preview = await within(dialog).findByTestId("plan-preview");
    expect(within(preview).getByText("1: Go to market")).toBeTruthy();
    expect(within(preview).getByText("Now 1 · Next 0 · Later 2")).toBeTruthy();
    expect(fake.mutations.filter((m) => m.path === "product.plan.preview").map((m) => m.input)).toEqual([{ fileText: PLAN, replaceUnstarted: false }]);

    await user.click(within(dialog).getByRole("checkbox", { name: "Retire roadmap items nobody has started" }));
    expect(await within(dialog).findByText("Unstarted items to retire")).toBeTruthy();
    expect(fake.mutations.filter((m) => m.path === "product.plan.preview").at(-1)?.input).toEqual({ fileText: PLAN, replaceUnstarted: true });

    const before = { ...fake.refetches };
    await user.click(within(dialog).getByTestId("plan-import-submit"));
    await waitFor(() => expect(screen.queryByTestId("plan-import-dialog")).toBeNull());
    expect(fake.mutations.find((m) => m.path === "product.plan.import")?.input).toEqual({ fileText: PLAN, replaceUnstarted: true });
    expect(await screen.findByText("Plan imported")).toBeTruthy();
    expect(screen.getByText("1 section rewritten, 1 section added, 3 roadmap items added, 3 unstarted items retired.")).toBeTruthy();
    for (const path of ["product.spec.get", "product.roadmap.list", "product.foundations.get"]) expect(fake.refetches[path] ?? 0).toBeGreaterThan(before[path] ?? 0);
  });

  it("lists the file's problems with their lines and keeps Import off", async () => {
    const user = userEvent.setup();
    render("owner", (path) => (path === "product.plan.preview" ? { ...PREVIEW, ok: false, errors: [{ line: 4, message: '"# Appendix" is not a part of a plan file.' }, { line: null, message: "The file has no vision." }] } : RESULT));
    await user.click(await screen.findByTestId("plan-import-open"));
    const dialog = await screen.findByTestId("plan-import-dialog");
    await user.upload(within(dialog).getByTestId("plan-file-input"), file(PLAN, "plan.md"));
    const errors = await within(dialog).findByTestId("plan-file-errors");
    expect(within(errors).getAllByRole("listitem").map((li) => li.textContent)).toEqual(['Line 4: "# Appendix" is not a part of a plan file.', "The file has no vision."]);
    expect(within(dialog).queryByTestId("plan-preview")).toBeNull();
    expect((within(dialog).getByTestId("plan-import-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses a file that is not Markdown before asking the api", async () => {
    const user = userEvent.setup({ applyAccept: false });
    const fake = render("owner", () => PREVIEW);
    await user.click(await screen.findByTestId("plan-import-open"));
    const dialog = await screen.findByTestId("plan-import-dialog");
    await user.upload(within(dialog).getByTestId("plan-file-input"), file("notes", "plan.txt"));
    expect((await within(dialog).findByTestId("plan-file-problem")).textContent).toBe("Choose a Markdown file (.md).");
    expect(fake.mutations.some((m) => m.path === "product.plan.preview")).toBe(false);
  });
});
