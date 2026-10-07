/**
 * Public types for @founder-manager/entity-linker (BUILD §2.1 rule 3, §11.3 "Hyperlinking pipeline").
 *
 * The pipeline is: manifest → Opus writes `[[ent:<uuid>|Name]]` → validator → (one re-ask) → Haiku sweep → render tree
 * → `EntityLink` in Dugout. Every stage is a pure function over these types; nothing here touches the database or the
 * network, so the whole package runs unchanged under MODEL_MODE=mock.
 */
import type { EntityKind } from "@founder-manager/shared";
import type { z } from "zod";

// ---------------------------------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------------------------------

/** One entity as handed to `buildManifest`. Mirrors the `entities` table columns the linker needs (BUILD §7.2). */
export interface ManifestEntityInput {
  id: string;
  kind: EntityKind;
  /** `entities.display_name`. */
  name: string;
  /** `entities.aliases`; matched case-insensitively as a whole span. */
  aliases?: readonly string[];
  /**
   * False when the founder must not see this entity from this note (BUILD §7.3 visibility, archived or merged rows).
   * Invisible entities are kept in the manifest so the validator can name them, but they are left out of the prompt
   * text and any markup pointing at them is rejected.
   */
  visible?: boolean;
  /** Optional role or job title shown to the model to help disambiguation ("CFO", "lead", "supplier"). */
  role?: string;
  /** Optional organisation the entity belongs to (people), shown to the model to help disambiguation. */
  org?: string;
}

/** A manifest entry after normalisation. */
export interface ManifestEntity {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: readonly string[];
  visible: boolean;
  role?: string;
  org?: string;
  /** Normalised forms (see `normalizeName`) of `name` and every alias, deduplicated. Used by exact/alias matching. */
  keys: readonly string[];
}

export interface Manifest {
  /** Every entity, visible or not, in input order (deduplicated by id; the first occurrence wins). */
  readonly entities: readonly ManifestEntity[];
  readonly byId: ReadonlyMap<string, ManifestEntity>;
  /** Normalised name or alias → every visible entity that carries it. Several entities may share an alias. */
  readonly byAlias: ReadonlyMap<string, readonly ManifestEntity[]>;
  /** Visible entity ids. */
  readonly visibleIds: ReadonlySet<string>;
  /** Visible entities only, as `id | kind | name | aliases` lines joined with newlines, for prompts (BUILD §12.2). */
  readonly text: string;
  /** The same lines as an array, for templates that take a list (packages/agents `entity_sweep`). */
  readonly lines: readonly string[];
  /** Visible entities as plain JSON for prompts and the mock model client, which reads a `manifest` array. */
  toJSON(): ManifestJsonEntry[];
  has(id: string): boolean;
  isVisible(id: string): boolean;
  get(id: string): ManifestEntity | undefined;
}

export interface ManifestJsonEntry {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  role?: string;
  org?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Markup segments
// ---------------------------------------------------------------------------------------------------------------------

export interface TextSegment {
  kind: "text";
  text: string;
}

/** A `[[ent:<id>|Display]]` mention. */
export interface EntitySegment {
  kind: "entity";
  id: string;
  display: string;
  /** How the link was made. `markup` = written by the composing model; the rest are sweep tiers. */
  source?: LinkSource;
  /** 0–1. Markup written with a valid manifest id is 1. */
  confidence?: number;
}

export type LinkSource = "markup" | "exact" | "alias" | "fuzzy" | "partial" | "model";

export interface AmbiguousCandidate {
  id: string;
  name: string;
  kind: EntityKind;
  /** Match score for this candidate (1 for exact and alias, the trigram similarity for fuzzy, 0.6 for partial). */
  score: number;
  tier: Exclude<LinkSource, "markup" | "model">;
}

/** A proper noun that matched more than one manifest entity: rendered with a dotted underline and "Which one?". */
export interface AmbiguousSegment {
  kind: "ambiguous";
  text: string;
  candidates: readonly AmbiguousCandidate[];
}

/** A proper noun that matched nothing: a draft CRM entity flagged unverified (BUILD §11.3). */
export interface DraftSegment {
  kind: "draft";
  name: string;
  kindGuess: EntityKind;
}

export type Segment = TextSegment | EntitySegment;
export type SweepSegment = TextSegment | EntitySegment | AmbiguousSegment | DraftSegment;

// ---------------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------------

export interface MentionProblem {
  id: string;
  display: string;
}

export interface MalformedMarkup {
  /** The raw text that looked like markup but did not parse (`[[ent:` without a well-formed id/display/closing). */
  raw: string;
  index: number;
}

export interface DisplayMismatch {
  id: string;
  display: string;
  /** The entity's display name in the manifest. */
  name: string;
}

export interface ValidationResult {
  valid: boolean;
  /** Ids not in the manifest. */
  unknownIds: string[];
  /** Ids in the manifest but marked invisible. */
  invisibleIds: string[];
  /** Every offending mention (unknown or invisible) with the display text the model used, in document order. */
  problems: MentionProblem[];
  /** `[[ent:` sequences that did not parse. They also make the text invalid: a broken link must not reach render. */
  malformed: MalformedMarkup[];
  /** Mentions whose display text is neither the name, an alias nor a word of the name. Advisory only. */
  displayMismatches: DisplayMismatch[];
  /** Every valid mention's id, deduplicated, in document order (what `inbox_items.entity_ids` should hold). */
  entityIds: string[];
  /** Number of `[[ent:...]]` mentions parsed. */
  mentionCount: number;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------------------------------------------------

export interface LinkedMention {
  text: string;
  id: string;
  name: string;
  kind: EntityKind;
  source: Exclude<LinkSource, "markup">;
  confidence: number;
}

export interface AmbiguousMention {
  text: string;
  candidates: readonly AmbiguousCandidate[];
}

export interface DraftMention {
  name: string;
  kindGuess: EntityKind;
  /** Number of times the span occurred in the text. */
  occurrences: number;
}

export interface SweepResult {
  /** The text with every link the sweep made written as `[[ent:<id>|Span]]`; ambiguous and draft spans stay plain. */
  text: string;
  /** Rich segments for the render tree: markup links, sweep links, ambiguous spans and drafts. */
  segments: SweepSegment[];
  linked: LinkedMention[];
  ambiguous: AmbiguousMention[];
  drafts: DraftMention[];
  /** True when the Haiku route was called for ambiguous spans. */
  usedModel: boolean;
  /** Set when the model call failed or returned unusable output; the spans stayed ambiguous. */
  modelError?: string;
  /** Ambiguous spans the model resolved (counted in `linked` with source `model`). */
  modelResolved: number;
}

/**
 * The slice of `@founder-manager/models` `ModelClient` the sweep needs. Structural so tests can pass a stub, and so
 * `MockModelClient` and `LiveModelClient` are accepted as they are: this package only ever makes schema requests, so
 * `schema` is required here and matches the models client's typed overload (`src/__tests__/mock-client.test.ts`
 * asserts the assignability at compile time).
 */
export interface LinkerModelClient {
  readonly mode: "mock" | "live";
  complete<T>(req: LinkerCompleteRequest<T>): Promise<LinkerCompleteResult<T>>;
}

export interface LinkerCompleteRequest<T> {
  route: "linker";
  system?: string | readonly string[];
  messages: readonly { role: "user" | "assistant"; content: string }[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  temperature?: number;
  scope?: string;
  attribution?: { businessId?: string; inboxItemId?: string; kind?: string };
}

export interface LinkerCompleteResult<T> {
  text: string;
  json?: T;
}

// ---------------------------------------------------------------------------------------------------------------------
// Render tree
// ---------------------------------------------------------------------------------------------------------------------

export interface TextNode {
  type: "text";
  text: string;
}

/** Rendered by Dugout `EntityLink` (DESIGN §8: kind icon 14 px, `accent-link`, hover card after 300 ms). */
export interface EntityNode {
  type: "entity";
  id: string;
  display: string;
  kind?: EntityKind;
  /** Manifest display name, when known (the hover card title). */
  name?: string;
  href?: string;
}

/** Dotted underline with the "Which one?" prompt; `candidates` populate the chooser. */
export interface AmbiguousNode {
  type: "ambiguous";
  text: string;
  candidates: readonly AmbiguousCandidate[];
  prompt: string;
  decoration: "dotted-underline";
}

/** An unverified draft entity: rendered as text with an "Unverified" chip and a create-in-CRM affordance. */
export interface DraftNode {
  type: "draft";
  name: string;
  kindGuess: EntityKind;
  flag: "unverified";
}

export type RenderNode = TextNode | EntityNode | AmbiguousNode | DraftNode;
