import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { SkillGroup } from "@foundmill/shared/constants";
import { SkillCard, type LibrarySkillOption } from "./SkillCard";
import { SkillLibraryList, SkillReader } from "./SkillPicker";

const meta = {
  title: "Agents/Skill card",
  parameters: { layout: "padded" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

const SKILL: LibrarySkillOption = { key: "release_notes", name: "Release notes", description: "Writes release notes customers can follow: what changed, who it helps and what to do next.", categoryLabel: "Product", attribute: { name: "Release notes", group: "craft" } };

/** Each state: one that can be chosen, one chosen, one the agent has, one that cannot be chosen (its reason in place). */
export const States: Story = {
  render: () => (
    <div className="flex w-176 flex-col gap-2">
      <SkillCard skill={SKILL} state="available" suggested reason="Fits this role" onToggle={() => undefined} onPreview={() => undefined} />
      <SkillCard skill={SKILL} state="selected" onToggle={() => undefined} onPreview={() => undefined} previewing />
      <SkillCard skill={SKILL} state="added" result={{ tested: false }} effect="Used in 3 tasks since Nov 3" onRemove={() => undefined} />
      <SkillCard skill={SKILL} state="added" result={{ tested: true, rating: 14 }} onRemove={() => undefined} />
      <SkillCard skill={SKILL} state="unavailable" reason="Quill already has this skill" />
    </div>
  ),
};

const CATEGORIES = ["Product", "Engineering", "Marketing", "Finance", "Operations", "Legal"] as const;
const GROUPS: SkillGroup[] = ["craft", "judgement", "execution"];
const WORK = ["release notes", "pricing pages", "first emails", "contracts", "weekly reports", "launch posts", "support replies", "board updates"];

/** A library of `n` skills across six categories, for the list's long states. */
function makeLibrary(n: number): LibrarySkillOption[] {
  return Array.from({ length: n }, (_, i) => {
    const work = WORK[i % WORK.length]!;
    const name = `${work.charAt(0).toUpperCase()}${work.slice(1)} ${Math.floor(i / WORK.length) + 1}`;
    return { key: `skill_${i}`, name, description: `A short how-to for ${work}: the steps, the checks and what good looks like.`, categoryLabel: CATEGORIES[i % CATEGORIES.length]!, attribute: { name, group: GROUPS[i % GROUPS.length]! } };
  });
}

function BigLibrary() {
  const skills = makeLibrary(120);
  const [selected, setSelected] = useState<string[]>([]);
  const [reading, setReading] = useState<string | null>(null);
  return (
    <div className="flex h-160 w-176 flex-col">
      <SkillLibraryList
        className="flex-1"
        skills={skills}
        selected={selected}
        onToggle={(k) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))}
        suggested={[{ key: "skill_0", reason: "Fits this role" }, { key: "skill_9", reason: "Fits this role" }]}
        previewKey={reading}
        onPreview={setReading}
        preview={(k) => {
          const s = skills.find((x) => x.key === k)!;
          return <SkillReader name={s.name} instructionsMd={`# ${s.name}\n\n1. Read the brief.\n2. Draft it.\n3. Check it against the house rules.`} attribute={s.attribute} agentName="Quill" />;
        }}
      />
    </div>
  );
}

/** 120 skills: chips with counts, the count line, two panes, and the list drawing only what is in view. */
export const LibraryWith120Skills: Story = { name: "Library with 120 skills", render: () => <BigLibrary /> };
