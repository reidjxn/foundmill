/**
 * persona_portraits (0067, 0069): one AI-generated portrait per persona catalog key and character style, a platform asset
 * (no business). Only the service role reaches the table (RLS on, no policies, no app-role grants), so callers pass the
 * service connection.
 *
 * `put` is an idempotent upsert by (style, key) (a second generation of the same character replaces the first); `get`
 * returns the bytes for GET /personas/:style/:key; `readyKeys` says which of some keys already have a portrait in a style
 * (team.personas.ensure), optionally counting the rows of some models (the mock placeholder, when portraits are live) as
 * missing. Keys outside the catalog are refused on write and read as absent, so the table only ever holds catalog
 * characters: at most `AGENT_STYLES.length × PERSONAS.length` (960) rows.
 */
import { AGENT_STYLES, DEFAULT_AGENT_STYLE, personaByKey, type AgentStyle } from "@foundmill/shared";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { PERSONA_PORTRAIT_MIMES, personaPortraits, type PersonaPortraitMime } from "../schema";
import { maybeOne, one, parseInput, type Executor } from "./_shared";

/** Largest portrait stored (the 0067 check): 8 MiB. */
export const PERSONA_PORTRAIT_MAX_BYTES = 8 * 1024 * 1024;

export interface PersonaPortraitRecord {
  key: string;
  style: AgentStyle;
  mime: PersonaPortraitMime;
  content: Uint8Array;
  model: string;
  createdAt: Date;
}

const PersonaKey = z.string().refine((k) => personaByKey(k) !== null, "not a persona catalog key");

export const PutPersonaPortraitInput = z.object({
  key: PersonaKey,
  /** The character style the image is drawn in; absent means humans (every row from before 0069). */
  style: z.enum(AGENT_STYLES).default(DEFAULT_AGENT_STYLE),
  mime: z.enum(PERSONA_PORTRAIT_MIMES),
  content: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "content must be bytes").refine((b) => b.byteLength > 0 && b.byteLength <= PERSONA_PORTRAIT_MAX_BYTES, `content must be 1 byte to ${PERSONA_PORTRAIT_MAX_BYTES} bytes`),
  model: z.string().trim().min(1).max(120),
});
export type PutPersonaPortraitInput = z.input<typeof PutPersonaPortraitInput>;

function toBytes(content: Uint8Array | ArrayBuffer | string): Uint8Array {
  // postgres.js hands bytea back as a Buffer (a Uint8Array subclass); PGlite as a Uint8Array; "\x…" is the text protocol.
  if (content instanceof Uint8Array) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return Uint8Array.from(Buffer.from(content.startsWith("\\x") ? content.slice(2) : content, "hex"));
}

export const personaPortraitsRepo = {
  /** The stored portrait of a key in a style, or null when it is not generated yet or the key is not in the catalog. */
  async get(db: Executor, key: string, style: AgentStyle = DEFAULT_AGENT_STYLE): Promise<PersonaPortraitRecord | null> {
    if (personaByKey(key) === null) return null;
    const row = maybeOne(await db.select().from(personaPortraits).where(and(eq(personaPortraits.style, style), eq(personaPortraits.personaKey, key))).limit(1));
    if (!row) return null;
    return { key: row.personaKey, style: row.style, mime: row.mime, content: toBytes(row.content), model: row.model, createdAt: row.createdAt };
  },

  /** Stores (or replaces) the portrait of a catalog key in a style. Idempotent: the same call twice leaves one row. */
  async put(db: Executor, input: PutPersonaPortraitInput): Promise<PersonaPortraitRecord> {
    const v = parseInput(PutPersonaPortraitInput, input, "persona portrait");
    const row = one(
      await db
        .insert(personaPortraits)
        .values({ personaKey: v.key, style: v.style, mime: v.mime, content: v.content, model: v.model })
        .onConflictDoUpdate({ target: [personaPortraits.style, personaPortraits.personaKey], set: { mime: v.mime, content: v.content, model: v.model } })
        .returning({ personaKey: personaPortraits.personaKey, style: personaPortraits.style, mime: personaPortraits.mime, model: personaPortraits.model, createdAt: personaPortraits.createdAt }),
      "persona portrait",
    );
    return { key: row.personaKey, style: row.style, mime: row.mime, content: v.content, model: row.model, createdAt: row.createdAt };
  },

  /**
   * Which of `keys` already have a portrait in `style` (humans unless given), in the order given (duplicates and
   * non-catalog keys dropped). A row made by one of `excludeModels` counts as missing: with live portraits the api passes
   * the mock model, so a placeholder left by a mock deployment is regenerated (and `put` replaces it).
   */
  async readyKeys(db: Executor, keys: readonly string[], options: { style?: AgentStyle; excludeModels?: readonly string[] } = {}): Promise<string[]> {
    const wanted = [...new Set(keys)].filter((k) => personaByKey(k) !== null);
    if (wanted.length === 0) return [];
    const style = options.style ?? DEFAULT_AGENT_STYLE;
    const excluded = [...new Set(options.excludeModels ?? [])];
    const rows = await db
      .select({ key: personaPortraits.personaKey })
      .from(personaPortraits)
      .where(and(eq(personaPortraits.style, style), inArray(personaPortraits.personaKey, wanted), excluded.length > 0 ? notInArray(personaPortraits.model, excluded) : undefined));
    const have = new Set(rows.map((r) => r.key));
    return wanted.filter((k) => have.has(k));
  },
};
