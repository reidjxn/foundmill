import "./setup";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { preloadMarkdown } from "@foundmill/dugout";
import { RecruitmentScreen } from "../RecruitmentScreen";
import { readSkillFile, toSkillChoices } from "../skills";
import { BID, DEPT_TEAM, dataResponses } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";

const LIBRARY = [
  { key: "newsletter_writing", skillKey: "library_newsletter_writing", name: "Newsletter writing", description: "Writes a regular customer newsletter.", category: "marketing", categoryLabel: "Marketing", attribute: { name: "Newsletter writing", group: "craft" }, whenToUse: "Use when the next issue needs writing.", version: 1, suggested: false, suggestedBecause: null, requires: [], notYetOnFoundmill: [], attribution: null },
  { key: "pricing_analysis", skillKey: "library_pricing_analysis", name: "Pricing analysis", description: "Compares pricing options on margin.", category: "finance", categoryLabel: "Finance", attribute: { name: "Pricing judgment", group: "judgement" }, whenToUse: "Use when a price is being set.", version: 2, suggested: false, suggestedBecause: null, requires: [{ connectorKey: "stripe", name: "Stripe", connected: false }], notYetOnFoundmill: [], attribution: "Adapted from marketing-skills:pricing under the MIT license." },
];
/** team.skills.library as the api answers it: the template's skills suggested, first. */
const libraryFor = (input: Record<string, unknown> | undefined) => (input?.templateKey === "newsletter_writer" ? [{ ...LIBRARY[0]!, suggested: true, suggestedBecause: "Fits this role" }, LIBRARY[1]!] : LIBRARY);
const SKILL_TEXT = { key: "pricing_analysis", name: "Pricing analysis", version: 2, attribution: "Adapted from marketing-skills:pricing under the MIT license.", instructionsMd: "# Pricing analysis\n\n## Steps\n\n- Compare options on **margin**.\n\n<b>raw</b>" };
const SKILL_MD = "---\nname: changelog-digest\ndescription: Turns a week of merged changes into a short digest.\n---\n# Changelog digest\n\n1. Group the changes.";
const PREVIEW = { name: "Changelog digest", description: "Turns a week of merged changes into a short digest.", format: "skill_md", fileName: "SKILL.md", sizeBytes: 120, lines: ["# Changelog digest", "1. Group the changes."], totalLines: 2, notes: [], group: "craft" };

const file = (content: string | Uint8Array, name: string) => new File([content as BlobPart], name, { type: "text/markdown" });

describe("readSkillFile", () => {
  it("accepts UTF-8 Markdown and text, and refuses other types, empty, oversized and non-UTF-8 files", async () => {
    expect(await readSkillFile(file(SKILL_MD, "SKILL.md"))).toEqual({ ok: true, fileName: "SKILL.md", content: SKILL_MD });
    expect(await readSkillFile(file("Plain notes that are long enough.", "notes.txt"))).toMatchObject({ ok: true });
    expect(await readSkillFile(file("%PDF", "skill.pdf"))).toEqual({ ok: false, message: expect.stringMatching(/SKILL\.md, a Markdown/) });
    expect(await readSkillFile(file("", "empty.md"))).toEqual({ ok: false, message: "The file is empty." });
    expect(await readSkillFile(file("x".repeat(64 * 1024 + 1), "big.md"))).toEqual({ ok: false, message: expect.stringMatching(/larger than 64 KB/) });
    expect(await readSkillFile(file(new Uint8Array([0x23, 0x20, 0xff, 0xfe, 0x41]), "latin.md"))).toEqual({ ok: false, message: expect.stringMatching(/not valid UTF-8/) });
  });

  it("turns chosen skills into the hire input", () => {
    expect(toSkillChoices([{ id: "a", source: "library", key: "nda_review", name: "NDA review", detail: "" }, { id: "b", source: "upload", fileName: "SKILL.md", content: "x", name: "X", detail: "" }])).toEqual([{ source: "library", key: "nda_review" }, { source: "upload", fileName: "SKILL.md", content: "x" }]);
  });
});

describe("the hire dialog's Skills step", () => {
  it("adds a library skill and an uploaded file (previewed first), lists them removable, and hires with both", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({
      businessId: BID,
      responses: { ...dataResponses, "team.skills.library": LIBRARY },
      onMutate: (path, input) => (path === "team.skills.preview" ? PREVIEW : { id: "new-agent", name: input.name ?? "Newsletter writer", status: "idle", modelKey: "sonnet" }),
    });
    renderScreen(fake, <RecruitmentScreen businessId={BID} departmentId={DEPT_TEAM} />);
    const table = await screen.findByRole("grid", { name: "Catalog" });
    fireEvent.contextMenu(within(table).getByText("Newsletter writer"));
    await user.click(await screen.findByRole("menuitem", { name: "Hire…" }));
    const dialog = await screen.findByTestId("hire-dialog");
    const step = within(dialog).getByTestId("hire-skills-step");
    expect(within(step).getByText("Skills (optional)")).toBeTruthy();

    // From the library: searchable, grouped, what each shows as.
    await user.click(within(step).getByRole("button", { name: "Add from library" }));
    const library = await screen.findByTestId("skill-library-dialog");
    expect(within(library).getByText("Shows as Judgment · Pricing judgment")).toBeTruthy();
    await user.click(within(library).getByRole("checkbox", { name: /Newsletter writing/ }));
    await user.click(within(library).getByTestId("skill-library-add"));
    await waitFor(() => expect(screen.queryByTestId("skill-library-dialog")).toBeNull());
    expect(within(step).getByRole("list", { name: "Chosen skills" }).textContent).toContain("Newsletter writing");

    // From a file: checked in the browser, previewed by the api, then added.
    await user.click(within(step).getByRole("button", { name: "Upload a skill file" }));
    const upload = await screen.findByTestId("skill-upload-dialog");
    expect((within(upload).getByTestId("skill-upload-add") as HTMLButtonElement).disabled).toBe(true);
    await user.upload(within(upload).getByTestId("skill-file-input"), file(SKILL_MD, "SKILL.md"));
    expect(await within(upload).findByRole("region", { name: "Preview of Changelog digest" })).toBeTruthy();
    expect(fake.mutations.find((m) => m.path === "team.skills.preview")?.input).toEqual({ fileName: "SKILL.md", content: SKILL_MD });
    await user.click(within(upload).getByTestId("skill-upload-add"));
    await waitFor(() => expect(screen.queryByTestId("skill-upload-dialog")).toBeNull());
    const chosen = within(step).getByRole("list", { name: "Chosen skills" });
    expect(within(chosen).getAllByRole("listitem")).toHaveLength(2);
    expect(within(chosen).getByText("Skill file")).toBeTruthy();

    // Removable before hiring; added again.
    await user.click(within(chosen).getByRole("button", { name: "Remove Newsletter writing" }));
    expect(within(step).getByRole("list", { name: "Chosen skills" }).textContent).not.toContain("Newsletter writing");
    await user.click(within(step).getByRole("button", { name: "Add from library" }));
    await user.click(within(await screen.findByTestId("skill-library-dialog")).getByRole("checkbox", { name: /Newsletter writing/ }));
    await user.click(screen.getByTestId("skill-library-add"));
    await waitFor(() => expect(screen.queryByTestId("skill-library-dialog")).toBeNull());

    await user.click(within(dialog).getByTestId("hire-confirm"));
    await waitFor(() => expect(fake.mutations.find((m) => m.path === "team.agents.hire")).toBeTruthy());
    expect(fake.mutations.find((m) => m.path === "team.agents.hire")!.input.skills).toEqual([{ source: "upload", fileName: "SKILL.md", content: SKILL_MD }, { source: "library", key: "newsletter_writing" }]);
    await waitFor(() => expect(screen.getByTestId("recruitment-notice").textContent).toBe("Newsletter writer hired with 2 added skills. Train it from its profile to tune its skills."));
  });

  it("suggests the skills for the template being hired, first, and opens a skill's whole text without losing the choice (WP-06 T7)", async () => {
    await preloadMarkdown();
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "team.skills.library": libraryFor, "team.skills.get": SKILL_TEXT } });
    renderScreen(fake, <RecruitmentScreen businessId={BID} departmentId={DEPT_TEAM} />);
    const table = await screen.findByRole("grid", { name: "Catalog" });
    fireEvent.contextMenu(within(table).getByText("Newsletter writer"));
    await user.click(await screen.findByRole("menuitem", { name: "Hire…" }));
    await user.click(within(await screen.findByTestId("hire-dialog")).getByRole("button", { name: "Add from library" }));
    const library = await screen.findByTestId("skill-library-dialog");
    expect(fake.inputs.get("team.skills.library")?.at(-1)).toEqual({ templateKey: "newsletter_writer" });
    const suggested = within(library).getByRole("region", { name: /Suggested for this agent/ });
    expect(within(suggested).getByText("Newsletter writing")).toBeTruthy();
    expect(within(suggested).getByText("Fits this role")).toBeTruthy();
    expect(within(library).getByText("Better with Stripe, not connected")).toBeTruthy();

    // Choose one, read another, come back: the choice is kept.
    await user.click(within(library).getByRole("checkbox", { name: /Newsletter writing/ }));
    await user.click(within(library).getByRole("button", { name: "Read the skill: Pricing analysis" }));
    const reader = await within(library).findByRole("region", { name: "Pricing analysis" });
    expect(fake.inputs.get("team.skills.get")?.at(-1)).toEqual({ key: "pricing_analysis" });
    expect(await within(reader).findByRole("heading", { name: "Steps" })).toBeTruthy();
    expect(within(reader).getByText("margin").tagName).toBe("STRONG");
    expect(reader.querySelector("b")).toBeNull();
    expect(within(reader).getByText("Adapted from marketing-skills:pricing under the MIT license.")).toBeTruthy();
    await user.click(within(reader).getByRole("button", { name: "Back to the library" }));
    expect(within(library).queryByRole("region", { name: "Pricing analysis" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(library).getByRole("button", { name: "Read the skill: Pricing analysis" })));
    expect((within(library).getByRole("checkbox", { name: /Newsletter writing/ }) as HTMLButtonElement).getAttribute("data-state")).toBe("checked");
    expect(within(library).getByTestId("skill-library-add").textContent).toBe("Add 1 skill");
  });

  it("shows the api's reason when a file is refused, and nothing can be added", async () => {
    const user = userEvent.setup();
    const reason = "This file permits moving money, which the house rules forbid (rule 1), so it was not added. Remove that line and upload it again.";
    const fake = createFakeSource({
      businessId: BID,
      responses: dataResponses,
      onMutate: (path) => {
        if (path === "team.skills.preview") throw new Error(reason);
        return {};
      },
    });
    renderScreen(fake, <RecruitmentScreen businessId={BID} departmentId={DEPT_TEAM} />);
    const table = await screen.findByRole("grid", { name: "Catalog" });
    fireEvent.contextMenu(within(table).getByText("Newsletter writer"));
    await user.click(await screen.findByRole("menuitem", { name: "Hire…" }));
    await user.click(within(await screen.findByTestId("hire-dialog")).getByRole("button", { name: "Upload a skill file" }));
    const upload = await screen.findByTestId("skill-upload-dialog");
    await user.upload(within(upload).getByTestId("skill-file-input"), file(SKILL_MD, "SKILL.md"));
    expect((await within(upload).findByTestId("skill-file-problem")).textContent).toBe(reason);
    expect((within(upload).getByTestId("skill-upload-add") as HTMLButtonElement).disabled).toBe(true);
    // A file the browser refuses never reaches the api.
    const before = fake.mutations.length;
    await user.upload(within(upload).getByTestId("skill-file-input"), file("x".repeat(64 * 1024 + 1), "big.md"));
    expect((await within(upload).findByTestId("skill-file-problem")).textContent).toMatch(/larger than 64 KB/);
    expect(fake.mutations.length).toBe(before);
  });
});
