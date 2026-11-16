import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { preloadMarkdown } from "../data/Markdown";
import { ChosenSkillList, SkillFilePreview, SkillLibraryList, SkillReader, matchesSkillQuery, showsAsLabel, type LibrarySkillOption } from "./SkillPicker";

beforeAll(() => preloadMarkdown());

const SKILLS: LibrarySkillOption[] = [
  { key: "release_notes", name: "Release notes", description: "Writes release notes customers can follow.", categoryLabel: "Product", attribute: { name: "Release notes", group: "craft" } },
  { key: "pricing_analysis", name: "Pricing analysis", description: "Compares pricing options on margin.", categoryLabel: "Finance", attribute: { name: "Pricing judgment", group: "judgement" } },
  { key: "meeting_notes", name: "Meeting notes and action items", description: "Decisions, owners and open questions.", categoryLabel: "Operations", attribute: { name: "Meeting notes", group: "execution" } },
];

describe("SkillLibraryList", () => {
  it("groups by category, says what each shows as, searches and toggles", () => {
    const onToggle = vi.fn();
    render(<SkillLibraryList skills={SKILLS} selected={["release_notes"]} onToggle={onToggle} unavailable={{ meeting_notes: "Already has this skill" }} />);
    expect(screen.getByRole("heading", { name: /Product/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Finance/ })).toBeTruthy();
    expect(screen.getByText("Shows as Judgment · Pricing judgment")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Release notes/ }) as HTMLButtonElement).getAttribute("data-state")).toBe("checked");
    // A skill the agent already has is listed with the reason and cannot be chosen.
    expect(screen.getByText("Already has this skill")).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /Meeting notes/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Pricing analysis/ }));
    expect(onToggle).toHaveBeenCalledWith("pricing_analysis");
    fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), { target: { value: "margin" } });
    expect(screen.queryByRole("heading", { name: /Product/ })).toBeNull();
    expect(screen.getByRole("checkbox", { name: /Pricing analysis/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search skills" }), { target: { value: "astronomy" } });
    expect(screen.getByRole("status").textContent).toMatch(/No skill matches “astronomy”/);
  });

  it("disables the rest once the most allowed are chosen", () => {
    render(<SkillLibraryList skills={SKILLS} selected={["release_notes"]} onToggle={() => {}} max={1} />);
    expect((screen.getByRole("checkbox", { name: /Pricing analysis/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Release notes/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("matches every word of the query across name, description, attribute and category", () => {
    expect(matchesSkillQuery(SKILLS[1]!, "finance judgment")).toBe(true);
    expect(matchesSkillQuery(SKILLS[1]!, "finance notes")).toBe(false);
    expect(matchesSkillQuery(SKILLS[0]!, "  ")).toBe(true);
    expect(showsAsLabel({ name: "Meeting notes", group: "execution" })).toBe("Execution · Meeting notes");
  });
});

describe("SkillFilePreview and ChosenSkillList", () => {
  it("previews a file with its first lines, the rest counted, and the notes", () => {
    render(<SkillFilePreview name="Changelog digest" description="Turns merged changes into a digest." fileName="SKILL.md" sizeBytes={2048} lines={["# Changelog digest", "1. Read the changes."]} totalLines={5} notes={["Its tool list is ignored: a skill never changes an agent's tools."]} />);
    const preview = screen.getByRole("region", { name: "Preview of Changelog digest" });
    expect(within(preview).getByText("SKILL.md · 2 KB")).toBeTruthy();
    expect(within(preview).getByLabelText("First lines").textContent).toContain("1. Read the changes.");
    expect(within(preview).getByText("and 3 more lines")).toBeTruthy();
    expect(within(preview).getByText(/tool list is ignored/)).toBeTruthy();
  });

  it("lists chosen skills with their source and untested state, and removes one", () => {
    const onRemove = vi.fn();
    render(<ChosenSkillList items={[{ id: "a", name: "Newsletter writing", source: "library", untested: true }, { id: "b", name: "Changelog digest", source: "upload", detail: "SKILL.md" }]} onRemove={onRemove} />);
    const list = screen.getByRole("list", { name: "Chosen skills" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Library")).toBeTruthy();
    expect(within(list).getByText("Skill file")).toBeTruthy();
    expect(within(list).getAllByText("Untested")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove Changelog digest" }));
    expect(onRemove).toHaveBeenCalledWith("b");
  });

  it("says so when nothing is chosen", () => {
    render(<ChosenSkillList items={[]} emptyText="No skills added yet." />);
    expect(screen.getByText("No skills added yet.")).toBeTruthy();
  });
});

describe("suggested skills and reading a skill (WP-06 T7)", () => {
  const WITH_SUGGESTED: LibrarySkillOption[] = [
    ...SKILLS,
    { key: "seo_plan", name: "First 90 days of search", description: "Plans search for a new project.", categoryLabel: "Marketing", attribute: { name: "Search planning", group: "judgement" }, suggested: true, suggestedBecause: "Fits this role", requires: [{ connectorKey: "web", name: "Web search and pages", connected: true }, { connectorKey: "posthog", name: "PostHog", connected: false }], notYetOnFoundmill: ["Search Console"] },
  ];

  it("lists suggested skills first, once, with the reason, and says what is missing", () => {
    render(<SkillLibraryList skills={WITH_SUGGESTED} selected={[]} onToggle={() => undefined} />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    expect(headings[0]).toMatch(/^Suggested/);
    const suggested = screen.getByRole("region", { name: /Suggested/ });
    expect(within(suggested).getByText("First 90 days of search")).toBeTruthy();
    expect(within(suggested).getByText("Fits this role")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Marketing/ })).toBeNull();
    expect(screen.getAllByRole("checkbox", { name: /First 90 days of search/ })).toHaveLength(1);
    // Only what is not connected is named on the row; what is not built yet is said plainly.
    expect(within(suggested).getByText("Better with PostHog, not connected")).toBeTruthy();
    expect(within(suggested).queryByText(/Web search and pages/)).toBeNull();
    expect(within(suggested).getByText("Not built yet: Search Console")).toBeTruthy();
  });

  it("offers each skill's text with a button, without choosing it", () => {
    const onRead = vi.fn();
    const onToggle = vi.fn();
    render(<SkillLibraryList skills={SKILLS} selected={[]} onToggle={onToggle} onRead={onRead} />);
    fireEvent.click(screen.getByRole("button", { name: "Read the skill: Pricing analysis" }));
    expect(onRead).toHaveBeenCalledWith("pricing_analysis");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders the text as Markdown, never as HTML, with what it is better with and where it comes from", async () => {
    const onBack = vi.fn();
    const md = "# Pricing\n\n## Steps\n\n- Compare **margin** per option.\n- Ask three customers.\n\n<script>alert(1)</script><b>raw</b>";
    const { container } = render(<SkillReader name="Pricing" instructionsMd={md} version={2} attribution="Adapted from marketing-skills:pricing under the MIT license." requires={[{ connectorKey: "stripe", name: "Stripe", connected: true }]} notYetOnFoundmill={[]} onBack={onBack} />);
    const reader = screen.getByRole("region", { name: "Pricing" });
    expect(await within(reader).findByRole("heading", { name: "Steps" })).toBeTruthy();
    expect(within(reader).getAllByRole("listitem").map((li) => li.textContent)).toEqual(expect.arrayContaining(["Compare margin per option.", "Ask three customers."]));
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(within(reader).getByText("Version 2")).toBeTruthy();
    expect(within(reader).getByText("Better with Stripe, connected")).toBeTruthy();
    expect(within(reader).getByText("Adapted from marketing-skills:pricing under the MIT license.")).toBeTruthy();
    // Focus moves onto the way back when the text opens.
    expect(document.activeElement).toBe(within(reader).getByRole("button", { name: "Back to the library" }));
    fireEvent.click(within(reader).getByRole("button", { name: "Back to the library" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("says when the text is loading or could not load", () => {
    const { rerender } = render(<SkillReader name="Pricing" instructionsMd={null} loading onBack={() => undefined} />);
    expect(screen.getByRole("status").textContent).toBe("Loading the skill…");
    rerender(<SkillReader name="Pricing" instructionsMd={null} error="The skill did not load." onBack={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toBe("The skill did not load.");
  });
});
