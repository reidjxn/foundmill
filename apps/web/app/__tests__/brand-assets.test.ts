/**
 * The Open Graph card (public/brand/foundmill-og.svg, rasterized to app/opengraph-image.png by
 * scripts/brand-assets.mts --png) is every link preview of the product: it carries APP_TAGLINE word for word, so a
 * tagline change or the 2026-10-08 vocabulary rule ("team", never "squad") cannot leave a stale card behind.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import { describe, expect, it } from "vitest";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SVG = join(WEB, "public", "brand", "foundmill-og.svg");
const PNG = join(WEB, "app", "opengraph-image.png");

const svg = readFileSync(SVG, "utf8");
const texts = [...svg.matchAll(/<(text|title)\b[^>]*>([^<]*)<\/\1>/g)].map((m) => m[2]!);

describe("Open Graph card", () => {
  it("prints the tagline from packages/config and names the product by APP_NAME", () => {
    expect(texts).toContain(APP_TAGLINE);
    expect(texts.some((t) => t.startsWith(`${APP_NAME} — ${APP_TAGLINE}`))).toBe(true);
    expect(svg).toContain(`aria-label="${APP_NAME}"`);
  });

  it("carries no football words", () => {
    for (const t of texts) expect(t).not.toMatch(/\b(?:squad|club|formation|match[\s-]?day|season)\b/i);
  });

  it("ships the raster the layout's openGraph metadata serves, 1200 × 630", () => {
    const png = readFileSync(PNG);
    expect(statSync(PNG).size).toBeGreaterThan(10_000);
    // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
