/**
 * Manifest builder (BUILD §11.3 "manifest (entities relevant to the event: id, kind, name, aliases)").
 *
 * The manifest is the contract between the composer and the validator: Opus may only write ids that are in it and
 * visible, and the sweep only links to it. `text` and `lines` are what goes into the prompt; `toJSON()` is what the
 * mock model client reads (it looks for a `manifest` array in the prompt JSON).
 */
import { ENTITY_KINDS, type EntityKind } from "@founder-manager/shared";
import { foldText } from "./trigram";
import type { Manifest, ManifestEntity, ManifestEntityInput, ManifestJsonEntry } from "./types";

const KIND_SET: ReadonlySet<string> = new Set(ENTITY_KINDS);

/**
 * Canonical form for exact and alias matching: diacritics folded, lowercased, punctuation other than `&` dropped,
 * whitespace collapsed. "Meridian Labs." and "meridian-labs" both become "meridian labs".
 */
export function normalizeName(input: string): string {
  return foldText(input)
    .replace(/[^\p{L}\p{N}&\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface BuildManifestOptions {
  /**
   * Validate `kind` against the shared vocabulary. Default true: an unknown kind throws, because the render layer maps
   * kinds to icons and a typo would silently fall through.
   */
  strictKinds?: boolean;
}

/** Build a manifest from entity rows. Duplicate ids keep the first row; blank names are skipped. */
export function buildManifest(entities: readonly ManifestEntityInput[], options: BuildManifestOptions = {}): Manifest {
  const strictKinds = options.strictKinds ?? true;
  const list: ManifestEntity[] = [];
  const byId = new Map<string, ManifestEntity>();
  const byAlias = new Map<string, ManifestEntity[]>();
  const visibleIds = new Set<string>();

  for (const input of entities) {
    const id = String(input.id ?? "").trim();
    const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
    if (!id || !name || byId.has(id)) continue;
    if (strictKinds && !KIND_SET.has(input.kind)) {
      throw new TypeError(`buildManifest: entity ${id} has unknown kind "${String(input.kind)}"`);
    }
    const kind = (KIND_SET.has(input.kind) ? input.kind : "organisation") as EntityKind;
    const aliases = dedupe(
      (input.aliases ?? [])
        .map((a) => String(a ?? "").trim().replace(/\s+/g, " "))
        .filter((a) => a.length > 0 && normalizeName(a) !== normalizeName(name)),
    );
    const keys = dedupe([normalizeName(name), ...aliases.map(normalizeName)].filter((k) => k.length > 0));
    const entity: ManifestEntity = {
      id,
      kind,
      name,
      aliases,
      visible: input.visible !== false,
      ...(input.role ? { role: input.role.trim() } : {}),
      ...(input.org ? { org: input.org.trim() } : {}),
      keys,
    };
    list.push(entity);
    byId.set(id, entity);
    if (entity.visible) {
      visibleIds.add(id);
      for (const key of keys) {
        const bucket = byAlias.get(key);
        if (bucket) bucket.push(entity);
        else byAlias.set(key, [entity]);
      }
    }
  }

  const visible = list.filter((e) => e.visible);
  const lines = visible.map(manifestLine);
  const json = (): ManifestJsonEntry[] =>
    visible.map((e) => ({
      id: e.id,
      kind: e.kind,
      name: e.name,
      aliases: [...e.aliases],
      ...(e.role ? { role: e.role } : {}),
      ...(e.org ? { org: e.org } : {}),
    }));

  return {
    entities: list,
    byId,
    byAlias,
    visibleIds,
    text: lines.join("\n"),
    lines,
    toJSON: json,
    has: (id) => byId.has(id),
    isVisible: (id) => visibleIds.has(id),
    get: (id) => byId.get(id),
  };
}

/** `id | kind | name | aliases` — the line format packages/agents' `entity_sweep` and the composer prompt expect. */
export function manifestLine(e: ManifestEntity): string {
  const extras = [e.role, e.org].filter((v): v is string => Boolean(v));
  const base = `${e.id} | ${e.kind} | ${e.name} | ${e.aliases.length > 0 ? e.aliases.join(", ") : "-"}`;
  return extras.length > 0 ? `${base} | ${extras.join(", ")}` : base;
}

/** Look up every visible entity whose name or alias normalises to `span`. */
export function lookupByName(manifest: Manifest, span: string): readonly ManifestEntity[] {
  return manifest.byAlias.get(normalizeName(span)) ?? [];
}

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = normalizeName(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
