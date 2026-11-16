import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ChosenSkillList, SkillFilePreview, SkillLibraryList, SkillReader, type ChosenSkill, type LibrarySkillOption } from "./SkillPicker";

const meta = {
  title: "Agents/Skills",
  parameters: { layout: "padded" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

const LIBRARY: LibrarySkillOption[] = [
  { key: "interview_synthesis", name: "Customer interview synthesis", description: "Turns interview notes into themes, each backed by quotes and the record it came from.", categoryLabel: "Product", attribute: { name: "Interview synthesis", group: "craft" } },
  { key: "release_notes", name: "Release notes", description: "Writes release notes customers can follow: what changed, who it helps and what to do next.", categoryLabel: "Product", attribute: { name: "Release notes", group: "craft" } },
  { key: "pull_request_descriptions", name: "Pull request descriptions", description: "Describes a change so a reviewer understands why, what and how it was tested in two minutes.", categoryLabel: "Engineering", attribute: { name: "Pull request write-ups", group: "craft" } },
  { key: "newsletter_writing", name: "Newsletter writing", description: "Writes a regular customer newsletter with one main story, useful links and a plain sign-off.", categoryLabel: "Marketing", attribute: { name: "Newsletter writing", group: "craft" } },
  { key: "pricing_analysis", name: "Pricing analysis", description: "Compares pricing options on margin, customer willingness to pay and competitor positioning.", categoryLabel: "Finance", attribute: { name: "Pricing judgment", group: "judgement" } },
  { key: "meeting_notes", name: "Meeting notes and action items", description: "Turns a meeting into short notes: decisions, action items with owners and open questions.", categoryLabel: "Operations", attribute: { name: "Meeting notes", group: "execution" } },
];

function LibraryDemo() {
  const [selected, setSelected] = useState<string[]>(["newsletter_writing"]);
  return (
    <div className="w-[640px]">
      <SkillLibraryList skills={LIBRARY} selected={selected} onToggle={(k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))} unavailable={{ release_notes: "Already has this skill" }} />
      <p className="mt-3 text-small text-secondary">{selected.length} chosen</p>
    </div>
  );
}

/** Search by name, description, attribute or category; grouped by category; a skill the agent has is shown but disabled. */
export const Library: Story = { render: () => <LibraryDemo /> };

/** What the founder sees after choosing a SKILL.md, before adding it: its tool list is ignored, and said so. */
export const FilePreview: Story = {
  render: () => (
    <div className="w-[560px]">
      <SkillFilePreview
        name="Changelog digest"
        description="Turns a week of merged changes into a short digest customers can read in a minute."
        fileName="SKILL.md"
        sizeBytes={1460}
        lines={["# Changelog digest", "1. Read the merged pull requests of the week.", "2. Group them as New, Improved and Fixed.", "3. Keep the digest under 200 words."]}
        totalLines={9}
        notes={["Its tool list is ignored: a skill never changes an agent's tools."]}
      />
    </div>
  ),
};

function ChosenDemo() {
  const [items, setItems] = useState<ChosenSkill[]>([
    { id: "library_newsletter_writing", name: "Newsletter writing", source: "library", detail: "Writes a regular customer newsletter with one main story.", untested: true },
    { id: "upload_changelog_digest_ab12cd34", name: "Changelog digest", source: "upload", detail: "SKILL.md", untested: true },
  ]);
  return (
    <div className="w-[560px]">
      <ChosenSkillList items={items} onRemove={(id) => setItems((xs) => xs.filter((x) => x.id !== id))} emptyText="No skills added yet. They are optional; the template's skills come with the agent." />
    </div>
  );
}

/** The skills chosen in the hire dialog (or carried by an agent), each removable; untested until a training run scores it. */
export const Chosen: Story = { render: () => <ChosenDemo /> };

export const ChosenEmpty: Story = { render: () => <ChosenSkillList items={[]} emptyText="No skills added yet. They are optional; the template's skills come with the agent." /> };

const SUGGESTED: LibrarySkillOption[] = [
  { key: "project_page_copy", name: "Project page copy", description: "Writes the words for a project's public page so a stranger understands it in ten seconds and takes one step.", categoryLabel: "Marketing", attribute: { name: "Page copy", group: "craft" }, suggested: true, suggestedBecause: "Fits this role" },
  { key: "seo_plan", name: "First 90 days of search", description: "Plans what a new project does about search in its first 90 days, and says plainly what will not pay off yet.", categoryLabel: "Marketing", attribute: { name: "Search planning", group: "judgement" }, suggested: true, suggestedBecause: "Fits this role", requires: [{ connectorKey: "web", name: "Web search and pages", connected: true }, { connectorKey: "posthog", name: "PostHog", connected: false }], notYetOnFoundmill: ["Search Console"] },
  ...LIBRARY,
];

const PRICING_MD = [
  "# Pricing",
  "",
  "## When to use this",
  "",
  "When the founder asks what to charge, or a price is about to go on the project page.",
  "",
  "## Steps",
  "",
  "1. Write down what one sale costs to deliver.",
  "2. Compare **three** options on margin and on what customers said they would pay.",
  "3. Recommend one, with the reason in a sentence.",
  "",
  "- Label every number that is not real as an Estimate.",
  "- Never change a live price yourself: ask the founder first.",
].join("\n");

function SuggestedDemo() {
  const [selected, setSelected] = useState<string[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  const skill = SUGGESTED.find((s) => s.key === reading);
  return (
    <div className="w-[640px]">
      {skill ? (
        <SkillReader name={skill.name} instructionsMd={PRICING_MD} version={1} requires={skill.requires} notYetOnFoundmill={skill.notYetOnFoundmill} onBack={() => setReading(null)} />
      ) : (
        <SkillLibraryList skills={SUGGESTED} selected={selected} onToggle={(k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))} onRead={setReading} />
      )}
    </div>
  );
}

/** Opened for an agent: the skills that fit its role first, with the reason and what is not connected; "Read the skill" opens its text. */
export const Suggested: Story = { render: () => <SuggestedDemo /> };

/** One skill's whole text, rendered as Markdown (raw HTML is skipped), with what makes it better and where it comes from. */
export const Reader: Story = {
  render: () => (
    <div className="w-[640px]">
      <SkillReader name="Pricing" instructionsMd={PRICING_MD} version={2} attribution="Adapted from marketing-skills:pricing under the MIT license." requires={[{ connectorKey: "stripe", name: "Stripe", connected: true }]} onBack={() => undefined} />
    </div>
  ),
};

export const ReaderLoading: Story = { render: () => <SkillReader name="Pricing" instructionsMd={null} loading onBack={() => undefined} /> };
