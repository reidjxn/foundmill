/**
 * "Add department › From a sentence" (BUILD §11.13): a sentence becomes an editable draft (name, modules, icon,
 * color) the founder checks before anything is created. A local, deterministic reading like the CRM's natural-language
 * filters (DECISIONS: nothing the founder types is sent to a model or executed): module words and their everyday
 * synonyms pick the modules, "called …" or the opening noun phrase gives the name. Departments are labels over modules,
 * so the draft only ever names modules that exist.
 */
import { DEPT_COLOUR_TOKENS, MODULE_KEYS, type DeptColourToken, type ModuleKey } from "@foundmill/shared/constants";

export interface DepartmentDraft {
  name: string;
  moduleKeys: ModuleKey[];
  icon: string;
  colourToken: DeptColourToken;
}

/**
 * Words that point at a module, matched at the start of a word ("market" covers marketing, "recruit" recruiting); a cue
 * ending in a space is a whole word ("pr " is not "product"). "Team" is not a cue: "a support team" names a group, not
 * the Team module.
 */
const MODULE_CUES: Record<ModuleKey, readonly string[]> = {
  product: ["product", "research", "roadmap", "spec ", "specs ", "feature", "discovery", "vision", "user interview", "customer insight", "editorial"],
  development: ["develop", "engineer", "code ", "coding", "software", "build", "ship ", "shipping", "app ", "apps ", "website", "tech ", "technical", "qa ", "testing", "infrastructure", "formulation", "manufactur", "lab ", "labs ", "operations", "fulfil", "supply"],
  distribution: ["distribution", "market", "sales", "sell", "growth", "ads ", "advertis", "seo ", "content", "social", "outreach", "lead ", "leads ", "acquisition", "campaign", "pr ", "press", "brand", "partnership", "community", "newsletter", "email"],
  finance: ["financ", "money", "budget", "cash", "accounting", "bookkeep", "invoice", "payroll", "runway", "tax ", "taxes", "billing", "fundrais", "investor"],
  team: ["hiring", "hire ", "recruit", "agents ", "people ops", "staffing", "training", "onboarding", "culture", "hr "],
  legal: ["legal", "law ", "laws ", "lawyer", "contract", "compliance", "policy", "policies", "ip ", "trademark", "patent", "privacy", "gdpr", "regulat", "incorporat", "terms "],
};

/** The icon and color of the module the draft starts from (the archetype defaults, packages/agents DEPARTMENT_DEFAULTS). */
const MODULE_LOOK: Record<ModuleKey, { icon: string; colourToken: DeptColourToken }> = {
  product: { icon: "lightbulb", colourToken: "dept-1" },
  development: { icon: "code-2", colourToken: "dept-2" },
  distribution: { icon: "megaphone", colourToken: "dept-3" },
  finance: { icon: "landmark", colourToken: "dept-4" },
  team: { icon: "users", colourToken: "dept-5" },
  legal: { icon: "scale", colourToken: "dept-6" },
};

const LEADING = /^(?:(?:please\s+)?(?:create|add|make|set up|start|i\s+(?:want|need)|we\s+need)\s+)?(?:(?:a|an|the|one|new|our|my)\s+)*/i;
const NAME_STOP = /\s+(?:that|which|who|to|for|handling|handles|covering|covers|doing|does|with|so|where|in charge)\b.*$/i;
const NOUNS = /\s+(?:department|dept|team|group|unit|desk)$/i;

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to"]);

/** US title case: small words stay lower case after the first, short acronyms ("PR", "HR") stay as typed. */
function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      if (w.length <= 3 && /[A-Z]/.test(w) && w === w.toUpperCase()) return w;
      const lower = w.toLowerCase();
      return i > 0 && SMALL_WORDS.has(lower) ? lower : lower[0]!.toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** The modules a sentence names, in the platform's module order. */
export function modulesInSentence(sentence: string): ModuleKey[] {
  const text = ` ${sentence.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return MODULE_KEYS.filter((m) => MODULE_CUES[m].some((cue) => text.includes(` ${cue}`)));
}

/** The department's name: what follows "called"/"named", else the sentence's opening noun phrase, else the modules. */
export function nameFromSentence(sentence: string, moduleKeys: readonly ModuleKey[]): string {
  const called = /\b(?:called|named)\s+["“']?([^"”',.;:!?]+)/i.exec(sentence);
  const calledName = called?.[1]?.replace(NAME_STOP, "").trim();
  if (calledName) return titleCase(calledName).slice(0, 80);
  const opening = sentence
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(LEADING, "")
    .replace(NAME_STOP, "")
    .replace(NOUNS, "")
    .trim();
  const words = opening.split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.length <= 4) return titleCase(opening).slice(0, 80);
  if (moduleKeys.length > 0) return titleCase(moduleKeys.join(" and "));
  return "New department";
}

/** A draft from a sentence; the founder edits it before creating. `taken` colors are skipped when another is free. */
export function draftDepartment(sentence: string, taken: readonly string[] = []): DepartmentDraft {
  const moduleKeys = modulesInSentence(sentence);
  const look = moduleKeys[0] ? MODULE_LOOK[moduleKeys[0]] : { icon: "folder", colourToken: "dept-7" as DeptColourToken };
  const colourToken = taken.includes(look.colourToken) ? (DEPT_COLOUR_TOKENS.find((t) => !taken.includes(t)) ?? look.colourToken) : look.colourToken;
  return { name: nameFromSentence(sentence, moduleKeys), moduleKeys, icon: look.icon, colourToken };
}
