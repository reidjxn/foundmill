/**
 * Business logos: what may be stored and how it is checked (subpath `@foundmill/shared/logo`; pure, browser-safe).
 *
 * A logo is one of
 * - a raster the browser normalised (a square PNG or WebP of about 512 px drawn on a canvas; JPEG is accepted too),
 *   checked here by its magic bytes, its header dimensions and its size; or
 * - an SVG, accepted only as the output of `sanitiseSvg` (uploads and generated marks alike).
 *
 * It is stored as bytes plus a mime type and travels to the browser as a `data:` URL that is only ever used as an
 * `<img src>`. `isLogoDataUrl` is the one check every renderer applies before it draws one.
 */
import { sanitiseSvg, type SvgSanitiseResult } from "./logo-svg";

export * from "./logo-svg";

export const LOGO_MIMES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export type LogoMime = (typeof LOGO_MIMES)[number];
export const RASTER_LOGO_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type RasterLogoMime = (typeof RASTER_LOGO_MIMES)[number];

export const LOGO_SOURCES = ["upload", "generated"] as const;
export type LogoSource = (typeof LOGO_SOURCES)[number];

/** Largest file the founder may pick (the browser normalises rasters well below this before sending). */
export const LOGO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** Largest logo stored: 96 KiB of image bytes (128 KiB as base64). */
export const LOGO_MAX_BYTES = 96 * 1024;
/** The square the browser draws a raster upload into. */
export const LOGO_NORMALISED_PX = 512;
export const LOGO_MIN_PX = 16;
export const LOGO_MAX_PX = 1024;
/** File types the picker offers (and the server accepts). */
export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml,.svg";

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;

/** True only for `data:image/{png,jpeg,webp,svg+xml};base64,…` within the stored size: the only `src` a logo may have. */
export function isLogoDataUrl(src: unknown): src is string {
  if (typeof src !== "string") return false;
  if (src.length > 64 + Math.ceil(LOGO_MAX_BYTES / 3) * 4) return false;
  const m = DATA_URL_RE.exec(src);
  return Boolean(m && m[2]!.length % 4 === 0);
}

export function toLogoDataUrl(mime: LogoMime, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

export function parseLogoDataUrl(src: string): { mime: LogoMime; base64: string } | null {
  if (!isLogoDataUrl(src)) return null;
  const m = DATA_URL_RE.exec(src)!;
  return { mime: m[1] as LogoMime, base64: m[2]! };
}

// ---------------------------------------------------------------------------------------------------------------------
// base64 and UTF-8 without Node's Buffer (this module also runs in the browser)
// ---------------------------------------------------------------------------------------------------------------------

export function base64ToBytes(b64: string): Uint8Array | null {
  const clean = b64.replace(/\s+/g, "");
  if (clean.length % 4 !== 0 || !BASE64_RE.test(clean)) return null;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function utf8Decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Raster sniffing: magic bytes and header dimensions
// ---------------------------------------------------------------------------------------------------------------------

export interface RasterInfo {
  mime: RasterLogoMime;
  width: number;
  height: number;
}

const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sniffPng(b: Uint8Array): RasterInfo | string {
  if (b.length < 45) return "The PNG is truncated.";
  // The first chunk must be a 13-byte IHDR; the file must end with IEND.
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== "IHDR") return "The PNG has no header chunk.";
  if (ascii(b, b.length - 8, 4) !== "IEND") return "The PNG is truncated (no end chunk).";
  return { mime: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
}

function sniffJpeg(b: Uint8Array): RasterInfo | string {
  if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return "The JPEG is truncated (no end marker).";
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return "The JPEG is malformed.";
    const marker = b[o + 1]!;
    if (marker === 0xff) {
      o += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const size = u16be(b, o + 2);
    if (size < 2) return "The JPEG is malformed.";
    // Start of frame: every SOFn except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mime: "image/jpeg", height: u16be(b, o + 5), width: u16be(b, o + 7) };
    }
    if (marker === 0xda) break; // start of scan before a frame header
    o += 2 + size;
  }
  return "The JPEG has no frame header.";
}

function sniffWebp(b: Uint8Array): RasterInfo | string {
  if (b.length < 20) return "The WebP is truncated.";
  if (u32le(b, 4) + 8 !== b.length) return "The WebP's length does not match its header.";
  const chunk = ascii(b, 12, 4);
  if (b.length < (chunk === "VP8L" ? 25 : 30)) return "The WebP is truncated.";
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return "The WebP is malformed.";
    return { mime: "image/webp", width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return "The WebP is malformed.";
    const bits = u32le(b, 21);
    return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { mime: "image/webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return "The WebP has an unknown chunk.";
}

/** Identifies a PNG, JPEG or WebP by its magic bytes and reads its dimensions from the header; a reason otherwise. */
export function sniffRaster(bytes: Uint8Array): RasterInfo | string {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((v, i) => bytes[i] === v)) return sniffPng(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return sniffJpeg(bytes);
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return sniffWebp(bytes);
  return "Not a PNG, JPEG or WebP image.";
}

// ---------------------------------------------------------------------------------------------------------------------
// The one gate every stored logo passes
// ---------------------------------------------------------------------------------------------------------------------

/** What a client sends: raster bytes (base64) with their declared type, or SVG markup. */
export type LogoInput = { mime: RasterLogoMime; base64: string } | { mime: "image/svg+xml"; svg: string };

export interface CheckedLogo {
  mime: LogoMime;
  /** The bytes that are stored (for SVG: the sanitised document, UTF-8). */
  bytes: Uint8Array;
  base64: string;
  dataUrl: string;
  width: number;
  height: number;
  /** SVG only: what the sanitiser removed (at most 20 names, cut to 40 characters). */
  removed: string[];
  /** SVG only: how many things of each kind the sanitiser removed. */
  removedCounts: Record<string, number>;
  /** Hex colours read from an SVG's fills (rasters are read in the browser). */
  colours: string[];
}

export type LogoCheck = { ok: true; logo: CheckedLogo } | { ok: false; reason: string };

/**
 * Every result `checkLogo` passed, so a caller that already ran the check (an api procedure) can hand the result to
 * storage without running the sanitiser a second time, and storage can still tell a checked logo from a look-alike
 * object built by hand. Weak, so results are collected with the request.
 */
const CHECKED = new WeakSet<CheckedLogo>();

/** True only for an object `checkLogo` itself returned as passing. */
export function isCheckedLogo(value: unknown): value is CheckedLogo {
  return typeof value === "object" && value !== null && CHECKED.has(value as CheckedLogo);
}

function passed(logo: CheckedLogo): LogoCheck {
  CHECKED.add(logo);
  return { ok: true, logo };
}

/**
 * Validates a logo before it is stored: rasters by magic bytes (which must match the declared type), header dimensions
 * (16–1024 px, no more than 4:1) and size (LOGO_MAX_BYTES); SVG through `sanitiseSvg`, whose output must fit the same
 * budget. Pure, so the API and the tests share it.
 */
export function checkLogo(input: LogoInput): LogoCheck {
  if (input.mime === "image/svg+xml") {
    const result: SvgSanitiseResult = sanitiseSvg(input.svg, { maxOutputChars: LOGO_MAX_BYTES });
    if (!result.ok) return result;
    const bytes = utf8Encode(result.svg);
    if (bytes.length > LOGO_MAX_BYTES) return { ok: false, reason: "The SVG is too large after cleaning." };
    const base64 = bytesToBase64(bytes);
    return passed({ mime: "image/svg+xml", bytes, base64, dataUrl: toLogoDataUrl("image/svg+xml", base64), width: result.width, height: result.height, removed: result.removed, removedCounts: result.removedCounts, colours: result.colours });
  }
  if (!(RASTER_LOGO_MIMES as readonly string[]).includes(input.mime)) return { ok: false, reason: "Use a PNG, JPEG, WebP or SVG file." };
  if (input.base64.length > Math.ceil(LOGO_MAX_BYTES / 3) * 4 + 4) return { ok: false, reason: `The image is larger than ${LOGO_MAX_BYTES / 1024} KB after resizing.` };
  const bytes = base64ToBytes(input.base64);
  if (!bytes) return { ok: false, reason: "The image data is not valid base64." };
  if (bytes.length === 0) return { ok: false, reason: "The file is empty." };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, reason: `The image is larger than ${LOGO_MAX_BYTES / 1024} KB after resizing.` };
  const info = sniffRaster(bytes);
  if (typeof info === "string") return { ok: false, reason: info };
  if (info.mime !== input.mime) return { ok: false, reason: `The file says ${input.mime} but its contents are ${info.mime}.` };
  if (info.width < LOGO_MIN_PX || info.height < LOGO_MIN_PX) return { ok: false, reason: `The image is smaller than ${LOGO_MIN_PX} px.` };
  if (info.width > LOGO_MAX_PX || info.height > LOGO_MAX_PX) return { ok: false, reason: `The image is larger than ${LOGO_MAX_PX} px on a side.` };
  const ratio = info.width / info.height;
  if (ratio > 4 || ratio < 0.25) return { ok: false, reason: "The logo is too wide or too tall; use a mark that fits a square." };
  const base64 = bytesToBase64(bytes);
  return passed({ mime: info.mime, bytes, base64, dataUrl: toLogoDataUrl(info.mime, base64), width: info.width, height: info.height, removed: [], removedCounts: {}, colours: [] });
}
