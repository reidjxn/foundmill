/**
 * Import a plan (founder-only, Product › Vision; `product.plan.preview` and `product.plan.import`): a founder who
 * already has a written plan (a vision, a specification and a roadmap in one Markdown file, packages/agents
 * plan-import.ts) has it written into the business.
 *
 * - The vision goes on the foundations row (`repos.foundations.setVision`), its north star labeled Estimate unless the
 *   target says Forecast or Estimate.
 * - Each specification section the file names is written as the founder's edit: an existing section (matched with
 *   `normKey`) through `repos.product.editBlock` on its first paragraph, as the Specification editor saves (authored by
 *   the founder, pinned, its version bumped), and any other paragraphs of that section are retired (archived) so the
 *   section reads as the file says; a new section is created after every other one, authored by the founder and
 *   pinned. Sections the file does not name are never touched.
 * - Roadmap items are added through `repos.product.upsertRoadmapItem`, each horizon after the items already there, the
 *   acceptance criteria appended to the description. With `replaceUnstarted` (and a roadmap in the file), live items
 *   nobody has started are retired (archived) first; an item with started or finished work never is.
 *
 * Nothing is written while the first drafting of the foundations runs (its apply would write over the vision). The
 * import is one transaction with its audit entry. The spec and roadmap writes it reuses announce nothing through the
 * outbox (neither `product.spec.editBlock` nor `product.roadmap.upsert` emits an event), so neither does the import.
 */
import { normKey, parsePlanFile, roadmapItemDescription, type ParsedPlan, type PlanDoc, type PlanImportError } from "@foundmill/agents";
import { LIMITS } from "@foundmill/config";
import { FOUNDATIONS_DRAFTING_MESSAGE, repos, type Executor, type RoadmapItem, type SpecBlock } from "@foundmill/db";
import { ROADMAP_HORIZONS, ValidationError, type RoadmapHorizon } from "@foundmill/shared";
import { z } from "zod";
import { audit, type BusinessContext } from "../trpc";

export const PlanImportInput = z.object({
  /** The file's text (UTF-8); the parser checks its size in bytes and says which line is wrong. */
  fileText: z.string().max(LIMITS.planFileMaxBytes),
  replaceUnstarted: z.boolean().default(false),
});
export type PlanImportInput = z.input<typeof PlanImportInput>;

type HorizonCounts = Record<RoadmapHorizon, number>;
const zeroCounts = (): HorizonCounts => ({ now: 0, next: 0, later: 0 });

/** What `product.plan.preview` answers: the problems with their lines, or what the import would write. */
export interface PlanPreview {
  ok: boolean;
  errors: PlanImportError[];
  /** The file has a vision (it replaces the current one). */
  vision: boolean;
  sections: {
    /** Existing sections the file rewrites, as the business names them. */
    write: string[];
    /** Sections the file adds, as the file names them. */
    create: string[];
    /** Other paragraphs of the rewritten sections, retired so each section reads as the file says. */
    paragraphsRetired: number;
  };
  /** Items the file adds, per horizon. */
  roadmap: HorizonCounts;
  /** Live items nobody has started that `replaceUnstarted` retires (0 when it is off). */
  archive: number;
}

/** What `product.plan.import` wrote. */
export interface PlanImportResult {
  sectionsWritten: string[];
  sectionsCreated: string[];
  paragraphsRetired: number;
  itemsAdded: HorizonCounts;
  itemsArchived: number;
  visionSet: boolean;
}

interface SectionWrite {
  /** The section as the business names it. */
  section: string;
  /** Its first paragraph (the outline's target), written with the file's text. */
  block: SpecBlock;
  /** Its other live paragraphs. */
  others: SpecBlock[];
  doc: PlanDoc;
}

interface PlanTargets {
  writes: SectionWrite[];
  creates: { section: string; doc: PlanDoc }[];
  archive: RoadmapItem[];
  /** The next free position in each horizon once `archive` is retired. */
  offsets: HorizonCounts;
  drafting: boolean;
}

/** A section document opening with `section` as its level-2 heading (the business's spelling of a matched section). */
function withHeading(doc: PlanDoc, section: string): PlanDoc {
  const [first, ...rest] = doc.content;
  if (first?.type === "heading" && first.attrs.level === 2) return { ...doc, content: [{ ...first, content: [{ type: "text", text: section }] }, ...rest] };
  return doc;
}

/** Where each part of the plan lands in this business. Reads only. */
async function planTargets(tx: Executor, businessId: string, plan: ParsedPlan, replaceUnstarted: boolean): Promise<PlanTargets> {
  const [blocks, roadmap, foundations] = await Promise.all([repos.product.listBlocks(tx, businessId), repos.product.listRoadmap(tx, businessId), repos.foundations.get(tx, businessId)]);
  const bySection = new Map<string, SpecBlock[]>();
  for (const b of blocks) bySection.set(normKey(b.section), [...(bySection.get(normKey(b.section)) ?? []), b]);
  const writes: SectionWrite[] = [];
  const creates: { section: string; doc: PlanDoc }[] = [];
  for (const s of plan.sections) {
    const list = [...(bySection.get(normKey(s.name)) ?? [])].sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime());
    const [block, ...others] = list;
    if (block) writes.push({ section: block.section, block, others, doc: withHeading(s.content, block.section) });
    else creates.push({ section: s.name, doc: s.content });
  }
  // Retiring only makes sense when the file brings a roadmap to replace them with.
  const archive = replaceUnstarted && plan.parts.roadmap ? await repos.product.unstartedRoadmap(tx, businessId) : [];
  const retired = new Set(archive.map((i) => i.id));
  const offsets = zeroCounts();
  for (const i of roadmap) if (!retired.has(i.id)) offsets[i.horizon] = Math.max(offsets[i.horizon], i.position + 1);
  return { writes, creates, archive, offsets, drafting: foundations?.status === "drafting" };
}

const countsOf = (plan: ParsedPlan): HorizonCounts => {
  const counts = zeroCounts();
  for (const i of plan.roadmap) counts[i.horizon] += 1;
  return counts;
};

/** "Line 12: …" for the first problems, as a validation error the import answers with. */
function errorMessage(errors: readonly PlanImportError[]): string {
  const lines = errors.slice(0, 3).map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message));
  return `${lines.join(" ")}${errors.length > 3 ? ` (${errors.length - 3} more)` : ""}`;
}

/** `product.plan.preview`: what the import would write, or the file's problems. Writes nothing. */
export function previewPlanImport(input: PlanImportInput): { failed: PlanPreview } | { plan: ParsedPlan; run: (tx: Executor, businessId: string) => Promise<PlanPreview> } {
  const empty: PlanPreview = { ok: false, errors: [], vision: false, sections: { write: [], create: [], paragraphsRetired: 0 }, roadmap: zeroCounts(), archive: 0 };
  // Parsed before the caller opens a transaction, so a slow or failing parse never holds a connection.
  const parsed = parsePlanFile(input.fileText);
  if (!parsed.ok) return { failed: { ...empty, errors: parsed.errors } };
  const plan = parsed.plan;
  return { plan, run: (tx, businessId) => previewTargets(tx, businessId, plan, input.replaceUnstarted ?? false) };
}

async function previewTargets(tx: Executor, businessId: string, plan: ParsedPlan, replaceUnstarted: boolean): Promise<PlanPreview> {
  const t = await planTargets(tx, businessId, plan, replaceUnstarted);
  return {
    ok: !t.drafting,
    errors: t.drafting ? [{ line: null, message: FOUNDATIONS_DRAFTING_MESSAGE }] : [],
    vision: plan.vision !== null,
    sections: { write: t.writes.map((w) => w.section), create: t.creates.map((c) => c.section), paragraphsRetired: t.writes.reduce((n, w) => n + w.others.length, 0) },
    roadmap: countsOf(plan),
    archive: t.archive.length,
  };
}

/**
 * `product.plan.import`, step one: parse the file, outside any transaction. A file with problems is refused with the
 * first of them, naming their lines. Step two, `importPlan`, writes it in the caller's transaction (see the module
 * comment) and appends one audit entry.
 */
export function parsePlanForImport(fileText: string): ParsedPlan {
  const parsed = parsePlanFile(fileText);
  if (!parsed.ok) throw new ValidationError(errorMessage(parsed.errors), { errors: parsed.errors });
  return parsed.plan;
}

/** Writes a plan parsed by `parsePlanForImport` (parse first, outside the transaction). */
export async function importPlan(tx: Executor, ctx: Pick<BusinessContext, "businessId" | "userId">, plan: ParsedPlan, replaceUnstarted = false): Promise<PlanImportResult> {
  const { businessId, userId } = ctx;
  const t = await planTargets(tx, businessId, plan, replaceUnstarted);
  if (t.drafting) throw new ValidationError(FOUNDATIONS_DRAFTING_MESSAGE);

  if (plan.vision) await repos.foundations.setVision(tx, businessId, plan.vision, { importedBy: userId, importedAt: new Date().toISOString() });

  let paragraphsRetired = 0;
  for (const w of t.writes) {
    // The Specification editor's save: the founder's edit, pinned, version bumped.
    await repos.product.editBlock(tx, businessId, w.block.id, { content: w.doc, authoredByKind: "user", authoredBy: userId, pinned: true });
    for (const other of w.others) {
      await repos.product.archiveBlock(tx, businessId, other.id);
      paragraphsRetired += 1;
    }
  }
  for (const c of t.creates) await repos.product.createBlock(tx, businessId, { section: c.section, content: c.doc, authoredByKind: "user", authoredBy: userId, pinned: true });

  for (const item of t.archive) await repos.product.archiveRoadmapItem(tx, businessId, item.id);
  const itemsAdded = zeroCounts();
  for (const item of plan.roadmap) {
    await repos.product.upsertRoadmapItem(tx, businessId, { title: item.title, descriptionMd: roadmapItemDescription(item), horizon: item.horizon, status: "planned", position: t.offsets[item.horizon] + itemsAdded[item.horizon] });
    itemsAdded[item.horizon] += 1;
  }

  const result: PlanImportResult = {
    sectionsWritten: t.writes.map((w) => w.section),
    sectionsCreated: t.creates.map((c) => c.section),
    paragraphsRetired,
    itemsAdded,
    itemsArchived: t.archive.length,
    visionSet: plan.vision !== null,
  };
  await audit(tx, ctx, {
    action: "product.plan.import",
    target: { kind: "business", id: businessId },
    details: { ...result, archivedItemIds: t.archive.map((i) => i.id), replaceUnstarted, horizons: ROADMAP_HORIZONS.filter((h) => itemsAdded[h] > 0) },
  });
  return result;
}
