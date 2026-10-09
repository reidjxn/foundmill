/**
 * Logos in the browser (BUILD §11.1 Commit screen, §11.15 Settings › Business).
 *
 * - `readLogoFile`: a PNG, JPEG or WebP is decoded and drawn on a canvas into a 512 px square (contained, transparent
 *   padding), then encoded as WebP (PNG where the browser cannot), stepping quality and size down until it fits the
 *   96 KB the server stores. An SVG is read as text and sent as it is: the server sanitises it. Either way the result
 *   is a `data:` URL the server checks again (magic bytes, size, dimensions; the SVG allowlist) before it is shown or
 *   stored.
 * - `suggestKit`: two brand colours from a logo, from the hex colours the server read in an SVG or from the pixels of
 *   a raster (canvas), through the Commit screen's `extractPalette`.
 */
import { LOGO_MAX_BYTES, LOGO_NORMALISED_PX, LOGO_UPLOAD_MAX_BYTES } from "@foundmill/shared/logo";
import type { Kit } from "@foundmill/dugout";
import { extractPalette, normaliseHex } from "@/components/new/commit/naming";

export const LOGO_FILE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
export const LOGO_FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml,.svg";
export const LOGO_FILE_HINT = "PNG, JPEG, WebP or SVG up to 2 MB. Images are resized to 512 px in your browser and checked on the server.";

/** A logo the founder has chosen but not necessarily stored yet. */
export interface LogoDraft {
  source: "upload" | "generated";
  /** A checked `data:` URL (from `*.logo.prepare` or `*.logo.generate`). */
  dataUrl: string;
  /** Hex colours the server read from an SVG (rasters are read here). */
  colours: string[];
  /** A short label: the file name or the generated mark's name. */
  label: string;
}

export class LogoFileError extends Error {}

/** Size of the bytes a base64 `data:` URL carries. */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
}

function svgFileType(file: File): boolean {
  return file.type === "image/svg+xml" || (!file.type && /\.svg$/i.test(file.name));
}

/** Checks the picker's choice before anything is read: type and the 2 MB upload limit. */
export function checkLogoFile(file: File): void {
  if (!svgFileType(file) && !(LOGO_FILE_TYPES as readonly string[]).includes(file.type)) throw new LogoFileError("Choose a PNG, JPEG, WebP or SVG file.");
  if (file.size > LOGO_UPLOAD_MAX_BYTES) throw new LogoFileError("That file is larger than 2 MB.");
  if (file.size === 0) throw new LogoFileError("That file is empty.");
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new LogoFileError("That image could not be read."));
    img.src = src;
  });
}

/** Draws an image into a `px` square (contained, centred, transparent padding). */
function drawSquare(img: HTMLImageElement, px: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new LogoFileError("This browser cannot resize images.");
  const w = img.naturalWidth || px;
  const h = img.naturalHeight || px;
  const scale = Math.min(px / w, px / h);
  const dw = Math.round(w * scale);
  const dh = Math.round(h * scale);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, Math.round((px - dw) / 2), Math.round((px - dh) / 2), dw, dh);
  return canvas;
}

/** The smallest encoding that fits: WebP at falling quality, then smaller squares, then PNG. */
function encodeWithin(img: HTMLImageElement, maxBytes: number): string {
  for (const px of [LOGO_NORMALISED_PX, 384, 256]) {
    const canvas = drawSquare(img, px);
    for (const quality of [0.92, 0.82, 0.7]) {
      const url = canvas.toDataURL("image/webp", quality);
      if (!url.startsWith("data:image/webp")) break; // the browser has no WebP encoder
      if (dataUrlBytes(url) <= maxBytes) return url;
    }
    const png = canvas.toDataURL("image/png");
    if (dataUrlBytes(png) <= maxBytes) return png;
  }
  throw new LogoFileError("That image is too detailed to store as a logo. Try a simpler version or an SVG.");
}

/** Reads a picked file into a `data:` URL ready for `*.logo.prepare`. Throws LogoFileError with a sentence to show. */
export async function readLogoFile(file: File): Promise<string> {
  checkLogoFile(file);
  if (svgFileType(file)) return `data:image/svg+xml;base64,${utf8ToBase64(await file.text())}`;
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await decodeImage(objectUrl);
    return encodeWithin(img, LOGO_MAX_BYTES);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** RGBA pixels of an image on a small canvas (≤ 96 px); null when the browser cannot read them. */
export async function readPixels(src: string): Promise<Uint8ClampedArray | null> {
  if (typeof document === "undefined") return null;
  try {
    const img = await decodeImage(src);
    const scale = Math.min(1, 96 / Math.max(img.naturalWidth || 96, img.naturalHeight || 96));
    const w = Math.max(1, Math.round((img.naturalWidth || 96) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || 96) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
}

/**
 * Two brand colours from hex colours ranked by use (an SVG's fills): the first saturated colour is the primary, the
 * next one far enough in hue the secondary. Null when the logo has no usable colour (black, white and greys only).
 */
export function kitFromColours(colours: readonly string[]): Kit | null {
  const valid = colours.map((c) => normaliseHex(c)).filter((c): c is string => c !== null);
  if (!valid.length) return null;
  // Weighted pixels in rank order, so extractPalette's ranking follows the SVG's.
  const pixels: number[] = [];
  valid.forEach((hex, rank) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (let i = 0; i < (valid.length - rank) * 4; i++) pixels.push(r, g, b, 255);
  });
  return extractPalette(pixels);
}

/** Brand colours suggested by a logo: from the server's SVG colours, else from the image's pixels. */
export async function suggestKit(draft: Pick<LogoDraft, "dataUrl" | "colours">): Promise<Kit | null> {
  const fromColours = kitFromColours(draft.colours);
  if (fromColours) return fromColours;
  const pixels = await readPixels(draft.dataUrl);
  return pixels ? extractPalette(pixels, { sampleEvery: 2 }) : null;
}

/** "US$0.07" for an Estimate in minor units. */
export function formatCostEstimate(cost: { amountMinor: number; currency: string }): string {
  const amount = cost.amountMinor / 100;
  if (amount > 0 && amount < 0.01) return `under ${cost.currency === "USD" ? "US$" : `${cost.currency} `}0.01`;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: cost.currency, currencyDisplay: "symbol", minimumFractionDigits: 2 }).format(amount).replace(/^\$/, "US$");
}
