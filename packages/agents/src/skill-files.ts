/**
 * Skill files (founder request 2026-10-16): a founder uploads a skill for an agent as an Agent Skills `SKILL.md` (YAML
 * front matter with `name` and `description`, then Markdown instructions) or as plain `.md` / `.txt` (the name from the
 * first heading or the file name, the description from the first paragraph).
 *
 * A skill file comes from outside the business (a download, a colleague, a marketplace), so it is untrusted until it
 * passes these checks, and it is never followed as instructions to the platform: the parser only reads text (the front
 * matter parser understands `key: value`, quoted strings and `|` / `>` blocks, nothing that runs code), and
 * `screenSkill` refuses a skill that contradicts the house rules (`detectClubRuleViolation`, the detector the Training
 * screen uses) or that reads like a prompt injection. Every refusal says what to change.
 *
 * What passes is reference material in the agent's "## Skills" section, after the house rules, which still win
 * (`buildSystemPrompt`). A skill never changes an agent's tools, autonomy, spend caps or approvals.
 */
import { LIMITS } from "@foundmill/config";
import { detectClubRuleViolation } from "./club-rules";

/** The largest skill file accepted (UTF-8 bytes; the browser checks the same limit before sending). */
export const SKILL_FILE_MAX_BYTES = LIMITS.skillFileMaxBytes;
export const SKILL_NAME_MIN = 3;
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MIN = 20;
export const SKILL_DESCRIPTION_MAX = 1024;
/** A skill's instructions (about 5,000 words): long enough for a real skill, short enough to sit in every prompt. */
export const SKILL_INSTRUCTIONS_MAX_CHARS = 20_000;
/**
 * Library and uploaded skills one agent may carry (WP-06 T4; replaces the 2026-10-16 limit of 8). Each is one index
 * line in every prompt and its body loads on demand (`read_skill`), so the bound is the index, not the bodies.
 */
export const MAX_SKILLS_PER_AGENT = LIMITS.skillsPerAgentMax;
/** The skills index of one agent (`renderSkillIndex`), so the Skills section stays a bounded part of every prompt. */
export const SKILL_INDEX_MAX_CHARS = 8_000;
// SKILL_PRELOAD_MAX_CHARS (bodies loaded up front) lives in ./club-rules, which renders them; this file imports that one.
/** Lines of the instructions shown in the preview before adding. */
export const SKILL_PREVIEW_LINES = 8;

export const SKILL_FILE_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

export type SkillFileFormat = "skill_md" | "markdown" | "text";

export type SkillFileErrorCode =
  | "file_type"
  | "too_large"
  | "empty"
  | "encoding"
  | "hidden_text"
  | "front_matter"
  | "name"
  | "description"
  | "instructions"
  | "house_rules"
  | "injection";

export interface SkillFileError {
  code: SkillFileErrorCode;
  /** What the founder reads: the problem and what to change. */
  message: string;
  /** The offending line, when there is one (trimmed, at most 160 characters). */
  line?: string;
}

export interface ParsedSkillFile {
  name: string;
  description: string;
  /** The Markdown the agent receives (the front matter removed). */
  instructionsMd: string;
  format: SkillFileFormat;
  /** The whole file with line endings normalized and any byte order mark removed (what the content hash covers). */
  normalized: string;
  /** The first lines of the instructions, for the preview. */
  preview: string[];
  /** Front matter the platform does not use, said once (e.g. a tool list: a skill never changes an agent's tools). */
  notes: string[];
}

export type SkillFileResult = { ok: true; skill: ParsedSkillFile } | { ok: false; error: SkillFileError };

const fail = (code: SkillFileErrorCode, message: string, line?: string): { ok: false; error: SkillFileError } => ({ ok: false, error: { code, message, ...(line ? { line: clip(line) } : {}) } });
const clip = (s: string, max = 160) => {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// ---------------------------------------------------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------------------------------------------------

/** Keys of the Agent Skills format the platform reads or knowingly ignores; anything else is ignored as well. */
const TOOL_KEYS = new Set(["allowed-tools", "allowed_tools", "tools"]);

interface FrontMatter {
  fields: Map<string, string>;
  notes: string[];
}

function unquote(raw: string): { value: string } | { error: string } {
  const v = raw.trim();
  if (v.startsWith('"')) {
    if (!v.endsWith('"') || v.length < 2) return { error: "a double-quoted value is not closed" };
    return { value: v.slice(1, -1).replace(/\\(["\\nt])/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c)) };
  }
  if (v.startsWith("'")) {
    if (!v.endsWith("'") || v.length < 2) return { error: "a single-quoted value is not closed" };
    return { value: v.slice(1, -1).replace(/''/g, "'") };
  }
  // A trailing YAML comment (" # ..."), found without a backtracking pattern.
  const comment = v.search(/\s#/);
  return { value: comment >= 0 ? v.slice(0, comment).trimEnd() : v };
}

/**
 * The front matter between the opening `---` and the closing `---` (or `...`): top-level `key: value` pairs. A `|` or
 * `>` block takes the indented lines below it; nested maps and lists (e.g. `metadata:`) are skipped. YAML tags, anchors
 * and aliases are refused rather than interpreted: a skill file needs plain text values only.
 */
function parseFrontMatter(lines: string[]): FrontMatter | { error: SkillFileError } {
  const fields = new Map<string, string>();
  const notes: string[] = [];
  /** The key whose unquoted value may continue on indented lines (YAML's multi-line plain scalars). */
  let continues: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) {
      continues = null;
      continue;
    }
    if (raw.trimStart().startsWith("#")) continue;
    if (/^\s/.test(raw) && continues) {
      fields.set(continues, `${fields.get(continues)} ${raw.trim()}`);
      continue;
    }
    if (/^\s/.test(raw) || raw.trimStart().startsWith("- ")) continue; // inside a nested map or list we do not read
    continues = null;
    const m = /^([A-Za-z][\w-]*)\s*:(.*)$/.exec(raw);
    if (!m) return { error: { code: "front_matter", message: "The front matter has a line that is not `key: value`. Write each field on its own line, for example `name: Press releases`.", line: clip(raw) } };
    const key = m[1]!.toLowerCase();
    const rest = m[2]!.trim();
    if (/^[!&*]/.test(rest) || /\s[&*][\w-]+\s*$/.test(rest)) return { error: { code: "front_matter", message: "The front matter uses YAML tags, anchors or aliases. Write plain text values instead.", line: clip(raw) } };
    if (fields.has(key)) return { error: { code: "front_matter", message: `\`${key}\` appears twice in the front matter. Keep one.`, line: clip(raw) } };
    let value: string;
    if (/^[|>][+-]?$/.test(rest)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]!) || !lines[i + 1]!.trim())) block.push(lines[++i]!);
      const indent = block.filter((l) => l.trim()).reduce((min, l) => Math.min(min, l.length - l.trimStart().length), Number.POSITIVE_INFINITY);
      const body = block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n").trimEnd();
      value = rest.startsWith(">") ? body.replace(/\n(?!\n)/g, " ").replace(/\n\n/g, "\n") : body;
    } else if (rest === "") {
      // A nested map or list: its indented lines are skipped above.
      if (TOOL_KEYS.has(key)) notes.push("Its tool list is ignored: a skill never changes an agent's tools.");
      continue;
    } else {
      const unq = unquote(rest);
      if ("error" in unq) return { error: { code: "front_matter", message: `In the front matter, ${unq.error}.`, line: clip(raw) } };
      value = unq.value;
      if (!/^["']/.test(rest)) continues = key;
    }
    if (TOOL_KEYS.has(key)) {
      notes.push("Its tool list is ignored: a skill never changes an agent's tools.");
      continues = null;
      continue;
    }
    fields.set(key, value);
  }
  return { fields, notes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Names and descriptions
// ---------------------------------------------------------------------------------------------------------------------

/** `press-releases` (the Agent Skills naming style) → "Press releases"; other names keep their own casing. */
export function displaySkillName(name: string): string {
  const t = name.trim().replace(/\s+/g, " ");
  if (/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(t)) {
    const words = t.replace(/[-_]+/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return t;
}

/** The file name without its folder and extension, as words ("press-release_skill.md" → "Press release skill"). */
function nameFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return displaySkillName(base.replace(/\.[^.]+$/, "").toLowerCase());
}

/** An ATX heading line; its text is `headingText` (closing hashes removed in code: no ambiguous pattern on long lines). */
const HEADING = /^#{1,6}\s+\S/;
function headingText(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === "#") end--;
  return line.slice(0, end).replace(/^#{1,6}/, "").trim();
}

/** Markdown decoration removed for checking a line's words: list markers, heading marks, quote marks, emphasis. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:>\s*)*/, "")
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)+/, "")
    .replace(/[*_`]+/g, "")
    .trim();
}

// ---------------------------------------------------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------------------------------------------------

/** Characters that hide or reorder text: zero-width and bidirectional controls, and C0 controls other than tab and newline. */
const HIDDEN_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/;
// eslint-disable-next-line no-control-regex -- the point is to find control characters
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** The section headers the runtime writes around an agent's instructions; a skill may not imitate them. */
const RESERVED_HEADERS = /^#{1,6}\s*(house rules|your instructions|what you do|glossary|business brief|skills|training)\s*:?$/i;

/**
 * Prompt-injection phrasing: overrides, identity and delimiter spoofing, exfiltration and attempts to widen authority.
 * A `negatable` pattern is excused by a negation earlier in its sentence ("Never skip approvals" restates a rule).
 */
const INJECTION_PATTERNS: { re: RegExp; reason: string; negatable?: boolean }[] = [
  { re: /\b(ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(previous|prior|above|earlier|preceding|other|all|any|your)\b[^.\n]{0,20}\b(instructions?|rules|prompts?|messages|guidelines|guardrails|policies)\b/i, reason: "tells the agent to ignore its other instructions", negatable: true },
  { re: /\b(system|developer)\s+(prompt|message|instructions?)\b/i, reason: "refers to the agent's system prompt" },
  { re: /\byou are now (a|an|in|no longer)\b|\byou are no longer\b|\bact as (if you were|an? unrestricted)\b|\bpretend (that )?you (are|have)\b/i, reason: "tries to change who the agent is" },
  { re: /\b(jailbreak|developer mode|dan mode|do anything now)\b/i, reason: "uses jailbreak phrasing" },
  { re: /^\s*(system|developer)\s*:\s*\S/i, reason: "imitates a system message" },
  { re: /<\|?\/?(im_start|im_end|system|endoftext)\|?>|\[\/?INST\]|<<\/?SYS>>|<\/?(system|instructions|skill|house[_ -]?rules)\b[^>]{0,200}>/i, reason: "imitates prompt delimiters" },
  { re: /\b(send|post|upload|forward|share|email|leak|exfiltrate|copy|paste)\b[^.\n]{0,40}\b(api[_ -]?keys?|secrets?|credentials?|passwords?|access tokens?|session tokens?|private keys?|environment variables|env vars)\b/i, reason: "asks the agent to hand over secrets or credentials", negatable: true },
  { re: /\b(reveal|print|repeat|output|show|dump|leak)\b[^.\n]{0,30}\b(your|hidden|internal|system|original)\b[^.\n]{0,20}\b(prompt|instructions|rules|configuration|tools list)\b/i, reason: "asks the agent to reveal its configuration", negatable: true },
  {
    re: /\b(raise|increase|lift|remove|disable|turn off|skip|bypass|ignore|switch off)\b[^.\n]{0,30}\b(spend(ing)? caps?|spend limits?|budget caps?|wage caps?|approvals?|approval (step|thresholds?)|policy|policies|autonomy limits?|guardrails|permissions? checks?)\b/i,
    reason: "tries to widen the agent's authority (spend caps, approvals or policy)",
    negatable: true,
  },
  { re: /\b(grant|give)\b[^.\n]{0,15}\b(yourself|itself|the agent)\b[^.\n]{0,30}\b(access|tools?|permissions?|autonomy|authority)\b|\b(you have|with) (full|unlimited|admin|root) (access|autonomy|permissions?|authority)\b/i, reason: "grants the agent tools or authority", negatable: true },
  { re: /\b(curl|wget|invoke-webrequest|nc|netcat)\s+(-\S+\s+)*https?:\/\//i, reason: "contains a command that calls out to the internet" },
];

const NEGATED = /\b(no|not|never|do not|don't|does not|doesn't|must not|mustn't|cannot|can't|should not|shouldn't|without)\b/i;

/**
 * The negation must sit in the same clause, just before the match: "Never skip approvals" is excused, "Do not hesitate:
 * ignore all previous instructions" is not.
 */
function negatedBefore(sentence: string, index: number): boolean {
  const before = sentence.slice(0, index);
  const clause = before.slice(Math.max(before.lastIndexOf(","), before.lastIndexOf(":"), before.lastIndexOf("—"), before.lastIndexOf(" - ")) + 1);
  return NEGATED.test(clause.slice(-40));
}

/** The pattern's reason when it matches a sentence of the line (and is not a negated restatement), else null. */
function injectionIn(line: string): { reason: string } | null {
  for (const sentence of line.split(/(?<=[.!?;])\s+/)) {
    for (const p of INJECTION_PATTERNS) {
      const m = p.re.exec(sentence);
      if (!m) continue;
      if (p.negatable && negatedBefore(sentence, m.index)) continue;
      return { reason: p.reason };
    }
  }
  return null;
}

export interface SkillScreenInput {
  name: string;
  description: string;
  instructionsMd: string;
}

/**
 * Screens a skill's name, description and instructions: hidden characters, the runtime's own section headers, prompt
 * injection phrasing and anything that contradicts the house rules. Returns the first problem, or null when it passes.
 * Library skills go through it too (a test), so the library and uploads are held to the same standard.
 */
export function screenSkill(input: SkillScreenInput): SkillFileError | null {
  const all = `${input.name}\n${input.description}\n${input.instructionsMd}`;
  if (HIDDEN_CHARS.test(all)) return { code: "hidden_text", message: "The file contains invisible characters (zero-width or text-direction controls) that could hide instructions. Remove them and upload it again." };
  if (CONTROL_CHARS.test(all)) return { code: "encoding", message: "The file contains control characters a text file does not have. Save it as plain UTF-8 text and upload it again." };
  if (/<!--/.test(all)) return { code: "hidden_text", message: "The file contains an HTML comment, which the agent would read but you would not see. Remove the comment and upload it again." };
  const lines = all.split("\n");
  for (const line of lines) {
    if (RESERVED_HEADERS.test(line.trim())) return { code: "injection", message: "The file uses a heading the platform reserves for an agent's own sections. Rename the heading and upload it again.", line: clip(line) };
  }
  for (const line of lines) {
    const hit = injectionIn(line);
    if (hit) return { code: "injection", message: `This file ${hit.reason}, so it was not added. Remove that line and upload it again.`, line: clip(line) };
  }
  // House rules: every line of the skill, as the Training screen checks the lines a draft adds.
  const added = lines.map(plainLine).filter((l) => l.length > 0);
  const report = detectClubRuleViolation(added);
  const first = report.violations[0];
  if (first) return { code: "house_rules", message: `This file ${first.reason}, which the house rules forbid (rule ${first.ruleId}), so it was not added. Remove that line and upload it again.`, line: first.line };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------------

export interface SkillFileInput {
  fileName: string;
  /** The file decoded as UTF-8 text (the client decodes strictly and refuses anything else). */
  content: string;
}

/**
 * Parses and screens an uploaded skill file. Never throws on content: every problem comes back as a specific refusal.
 * The checks in order: file type, size, encoding, front matter, name and description, instructions, then `screenSkill`.
 */
export function parseSkillFile(input: SkillFileInput): SkillFileResult {
  const fileName = (input.fileName ?? "").trim();
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const ext = /\.[^.]+$/.exec(base)?.[0]?.toLowerCase() ?? "";
  if (!(SKILL_FILE_EXTENSIONS as readonly string[]).includes(ext)) return fail("file_type", "Upload a SKILL.md, a Markdown (.md) or a plain text (.txt) file.");
  const content = input.content ?? "";
  if (utf8ByteLength(content) > SKILL_FILE_MAX_BYTES) return fail("too_large", `The file is larger than ${SKILL_FILE_MAX_BYTES / 1024} KB. Keep a skill to its instructions, or split it into two skills.`);
  if (content.includes("\uFFFD")) return fail("encoding", "The file is not valid UTF-8 text. Save it as UTF-8 and upload it again.");
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return fail("empty", "The file is empty.");

  const lines = normalized.split("\n");
  const isSkillMd = base.toLowerCase() === "skill.md";
  let fields = new Map<string, string>();
  let notes: string[] = [];
  let bodyLines = lines;
  let format: SkillFileFormat = ext === ".txt" ? "text" : "markdown";
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (end < 0) return fail("front_matter", "The front matter is not closed. End it with a line containing only `---`.");
    const parsed = parseFrontMatter(lines.slice(1, end));
    if ("error" in parsed) return { ok: false, error: parsed.error };
    fields = parsed.fields;
    notes = [...new Set(parsed.notes)];
    bodyLines = lines.slice(end + 1);
    format = "skill_md";
  } else if (isSkillMd) {
    return fail("front_matter", "A SKILL.md file starts with front matter: a `---` line, then `name:` and `description:`, then `---`.");
  }

  let name: string;
  let description: string;
  if (format === "skill_md") {
    name = displaySkillName(fields.get("name") ?? "");
    description = (fields.get("description") ?? "").replace(/\s+/g, " ").trim();
    if (!name) return fail("name", "The front matter has no `name`. Add a line such as `name: Press releases`.");
    if (!description) return fail("description", "The front matter has no `description`. Add a line saying what the skill does and when to use it.");
  } else {
    // Plain Markdown or text: the first heading (else the file name), then the first paragraph that is not a heading.
    const headingIndex = bodyLines.findIndex((l) => HEADING.test(l.trim()));
    const firstText = bodyLines.findIndex((l) => l.trim().length > 0);
    const titled = headingIndex >= 0 && headingIndex === firstText;
    name = titled ? displaySkillName(headingText(bodyLines[headingIndex]!.trim()).replace(/[*_`]+/g, "")) : nameFromFileName(base);
    const after = titled ? bodyLines.slice(headingIndex + 1) : bodyLines;
    const start = after.findIndex((l) => l.trim().length > 0 && !HEADING.test(l.trim()));
    const paragraph: string[] = [];
    for (let i = start; start >= 0 && i < after.length && after[i]!.trim(); i++) paragraph.push(plainLine(after[i]!));
    description = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (description.length > SKILL_DESCRIPTION_MAX) description = `${description.slice(0, SKILL_DESCRIPTION_MAX - 1).replace(/\s+\S*$/, "")}…`;
    if (!description) return fail("description", "Add a short description: the first paragraph after the title says what the skill does and when to use it.");
  }
  if (name.length < SKILL_NAME_MIN || name.length > SKILL_NAME_MAX) return fail("name", `The skill's name must be ${SKILL_NAME_MIN} to ${SKILL_NAME_MAX} characters; "${clip(name, 80)}" is ${name.length}.`);
  if (/[\n<>{}[\]\\|]/.test(name)) return fail("name", "The skill's name has characters a name does not need (< > { } [ ] \\ |). Use words only.");
  if (description.length < SKILL_DESCRIPTION_MIN) return fail("description", `The description is too short. Say in at least ${SKILL_DESCRIPTION_MIN} characters what the skill does and when to use it.`);
  if (description.length > SKILL_DESCRIPTION_MAX) return fail("description", `The description is longer than ${SKILL_DESCRIPTION_MAX} characters. Keep it to what the skill does and when to use it.`);

  let first = 0;
  while (first < bodyLines.length && !bodyLines[first]!.trim()) first++;
  const instructionsMd = bodyLines.slice(first).join("\n").trimEnd();
  if (instructionsMd.replace(/\s/g, "").length < 20) return fail("instructions", "The file has no instructions after the front matter. Add the steps the agent should follow.");
  if (instructionsMd.length > SKILL_INSTRUCTIONS_MAX_CHARS) return fail("instructions", `The instructions are longer than ${SKILL_INSTRUCTIONS_MAX_CHARS.toLocaleString("en-US")} characters. Keep the essentials, or split them into two skills.`);

  const screened = screenSkill({ name, description, instructionsMd });
  if (screened) return { ok: false, error: screened };
  const preview = instructionsMd
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, SKILL_PREVIEW_LINES)
    .map((l) => clip(l, 200));
  return { ok: true, skill: { name, description, instructionsMd, format, normalized, preview, notes } };
}
