/**
 * business_logos (0017): the business's logo, one row per business.
 *
 * `set` is the only write path: it takes either a result `checkLogo` (@foundmill/shared/logo) returned, recognised by
 * `isCheckedLogo`, or raw input that it checks itself, so nothing reaches the table without the magic-byte, dimension
 * and size checks for rasters or the strict sanitiser for SVG, and the sanitiser runs once per request. Callers write with
 * the service role (app roles only read this table); the api checks that the caller is an owner or admin first.
 * `getMeta` leaves the bytes out so `business.get` stays small; `get` returns the image as a `data:` URL.
 */
import { createHash } from "node:crypto";
import { LOGO_SOURCES, checkLogo, isCheckedLogo, toLogoDataUrl, type CheckedLogo, type LogoInput, type LogoMime, type LogoSource } from "@foundmill/shared/logo";
import { ValidationError } from "@foundmill/shared";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { businessLogos, type BusinessLogo } from "../schema";
import { Id, maybeOne, one, parseInput, type Executor } from "./_shared";

export interface BusinessLogoMeta {
  source: LogoSource;
  mime: LogoMime;
  /** Hex sha256 of the stored bytes: the logo's version (clients key their cache on it). */
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  updatedAt: Date;
}

export interface BusinessLogoImage extends BusinessLogoMeta {
  /** `data:<mime>;base64,…`, only ever rendered through `<img src>`. */
  dataUrl: string;
}

export const SetLogoInput = z.object({
  source: z.enum(LOGO_SOURCES),
  /** Raw input (checked here), or the result of a `checkLogo` call the caller already made (used as it is). */
  logo: z.custom<LogoInput | CheckedLogo>((v) => typeof v === "object" && v !== null && "mime" in v, "logo input expected"),
  createdBy: Id.nullable().optional(),
});
export type SetLogoInput = z.input<typeof SetLogoInput>;

const META_COLUMNS = {
  source: businessLogos.source,
  mime: businessLogos.mime,
  sha256: businessLogos.sha256,
  width: businessLogos.width,
  height: businessLogos.height,
  updatedAt: businessLogos.updatedAt,
} as const;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toMeta(row: Pick<BusinessLogo, "source" | "mime" | "sha256" | "width" | "height" | "updatedAt">, bytes: number): BusinessLogoMeta {
  return { source: row.source, mime: row.mime, sha256: row.sha256, width: row.width, height: row.height, bytes, updatedAt: row.updatedAt };
}

function toBytes(content: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  // postgres.js hands bytea back as a Buffer; PGlite as a Uint8Array. A hex string ("\x…") is the text protocol.
  return Uint8Array.from(Buffer.from(content.startsWith("\\x") ? content.slice(2) : content, "hex"));
}

export const logosRepo = {
  /** The current logo without its bytes, or null when the business has none (the UI draws the initials mark). */
  async getMeta(db: Executor, businessId: string): Promise<BusinessLogoMeta | null> {
    // octet_length, so the bytes themselves never leave the database for a metadata read.
    const row = maybeOne(await db.select({ ...META_COLUMNS, bytes: sql<number>`octet_length(${businessLogos.content})` }).from(businessLogos).where(eq(businessLogos.businessId, businessId)).limit(1));
    return row ? toMeta(row, Number(row.bytes)) : null;
  },

  /** The current logo as a `data:` URL, or null. */
  async get(db: Executor, businessId: string): Promise<BusinessLogoImage | null> {
    const row = maybeOne(await db.select().from(businessLogos).where(eq(businessLogos.businessId, businessId)).limit(1));
    if (!row) return null;
    const bytes = toBytes(row.content);
    return { ...toMeta(row, bytes.length), dataUrl: toLogoDataUrl(row.mime, Buffer.from(bytes).toString("base64")) };
  },

  /**
   * Checks the logo (`checkLogo`) and stores it as the business's logo, replacing any previous one. Throws
   * ValidationError with the check's reason when it does not pass. Service role only (RLS: app roles read).
   */
  async set(db: Executor, businessId: string, input: SetLogoInput): Promise<{ meta: BusinessLogoMeta; checked: CheckedLogo; previous: BusinessLogoMeta | null }> {
    const v = parseInput(SetLogoInput, input, "logo");
    // A result checkLogo returned is stored as it is (the sanitiser runs once per request); anything else is checked.
    let logo: CheckedLogo;
    if (isCheckedLogo(input.logo)) logo = input.logo;
    else {
      const check = checkLogo(v.logo as LogoInput);
      if (!check.ok) throw new ValidationError(check.reason);
      logo = check.logo;
    }
    const previous = await logosRepo.getMeta(db, businessId);
    const values = { source: v.source, mime: logo.mime, content: logo.bytes, sha256: sha256Hex(logo.bytes), width: logo.width, height: logo.height, createdBy: v.createdBy ?? null, updatedAt: new Date() };
    const rows = await db
      .insert(businessLogos)
      .values({ businessId, ...values })
      .onConflictDoUpdate({ target: businessLogos.businessId, set: values })
      .returning(META_COLUMNS);
    return { meta: toMeta(one(rows, "logo", businessId), logo.bytes.length), checked: logo, previous };
  },

  /** Removes the logo (the business falls back to its initials mark). Returns what was removed, or null. */
  async remove(db: Executor, businessId: string): Promise<BusinessLogoMeta | null> {
    const previous = await logosRepo.getMeta(db, businessId);
    if (!previous) return null;
    await db.delete(businessLogos).where(eq(businessLogos.businessId, businessId));
    return previous;
  },
};
