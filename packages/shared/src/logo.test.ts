import { describe, expect, it } from "vitest";
import { makeJpeg, makePng, makeWebp } from "./testing/logo-fixtures";
import { base64ToBytes, bytesToBase64, checkLogo, isLogoDataUrl, LOGO_MAX_BYTES, parseLogoDataUrl, sniffRaster, toLogoDataUrl } from "./logo";

const b64 = (bytes: Uint8Array) => bytesToBase64(bytes);

describe("sniffRaster: magic bytes and header dimensions", () => {
  it("reads PNG, JPEG and WebP sizes from their headers", () => {
    expect(sniffRaster(makePng(512, 512))).toEqual({ mime: "image/png", width: 512, height: 512 });
    expect(sniffRaster(makeJpeg(640, 480))).toEqual({ mime: "image/jpeg", width: 640, height: 480 });
    expect(sniffRaster(makeWebp(512, 384))).toEqual({ mime: "image/webp", width: 512, height: 384 });
  });

  it("refuses anything else, and truncated files", () => {
    expect(sniffRaster(new TextEncoder().encode("<svg onload=alert(1)>"))).toMatch(/Not a PNG/);
    expect(sniffRaster(new TextEncoder().encode("GIF89a........"))).toMatch(/Not a PNG/);
    const png = makePng(32, 32);
    expect(sniffRaster(png.subarray(0, png.length - 12))).toMatch(/truncated/);
    const jpeg = makeJpeg(32, 32);
    expect(sniffRaster(jpeg.subarray(0, jpeg.length - 2))).toMatch(/truncated/);
    const webp = makeWebp(32, 32);
    expect(sniffRaster(webp.subarray(0, webp.length - 1))).toMatch(/length/);
  });
});

describe("checkLogo: upload validation", () => {
  it("accepts a normalised square PNG, WebP or JPEG and returns a data URL", () => {
    for (const [mime, bytes] of [
      ["image/png", makePng(512, 512)],
      ["image/webp", makeWebp(512, 512)],
      ["image/jpeg", makeJpeg(512, 512)],
    ] as const) {
      const r = checkLogo({ mime, base64: b64(bytes) });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.logo).toMatchObject({ mime, width: 512, height: 512 });
      expect(r.logo.dataUrl.startsWith(`data:${mime};base64,`)).toBe(true);
      expect(isLogoDataUrl(r.logo.dataUrl)).toBe(true);
    }
  });

  it("refuses a file whose contents do not match its declared type (an SVG or HTML called PNG)", () => {
    expect(checkLogo({ mime: "image/png", base64: b64(makeJpeg(64, 64)) })).toEqual({ ok: false, reason: "The file says image/png but its contents are image/jpeg." });
    expect(checkLogo({ mime: "image/png", base64: b64(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')) })).toMatchObject({ ok: false, reason: expect.stringMatching(/Not a PNG/) });
    expect(checkLogo({ mime: "image/gif" as "image/png", base64: b64(makePng(64, 64)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/PNG, JPEG, WebP or SVG/) });
  });

  it("refuses oversize files, out-of-range dimensions and extreme aspect ratios", () => {
    const big = makePng(256, 256, [10, 20, 30, 255], { noise: true });
    const padded = new Uint8Array(LOGO_MAX_BYTES + 1);
    padded.set(big);
    expect(checkLogo({ mime: "image/png", base64: b64(padded) })).toMatchObject({ ok: false, reason: expect.stringMatching(/larger than 96 KB/) });
    expect(checkLogo({ mime: "image/png", base64: b64(makePng(8, 8)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/smaller than 16 px/) });
    expect(checkLogo({ mime: "image/webp", base64: b64(makeWebp(2048, 2048)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/larger than 1024 px/) });
    expect(checkLogo({ mime: "image/png", base64: b64(makePng(500, 100)) })).toMatchObject({ ok: false, reason: expect.stringMatching(/too wide/) });
  });

  it("refuses invalid base64 and empty files", () => {
    expect(checkLogo({ mime: "image/png", base64: "not base64!" })).toMatchObject({ ok: false, reason: expect.stringMatching(/base64/) });
    expect(checkLogo({ mime: "image/png", base64: "" })).toMatchObject({ ok: false, reason: "The file is empty." });
  });

  it("sanitises SVG and stores the cleaned document", () => {
    const r = checkLogo({ mime: "image/svg+xml", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10" fill="#1b4fd8"/></svg>' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = new TextDecoder().decode(r.logo.bytes);
    expect(text).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="512" height="512"><rect width="10" height="10" fill="#1b4fd8"/></svg>');
    expect(r.logo.removed).toEqual(["attribute:onload", "element:script"]);
    expect(r.logo.colours).toEqual(["#1b4fd8"]);
    expect(parseLogoDataUrl(r.logo.dataUrl)).toEqual({ mime: "image/svg+xml", base64: r.logo.base64 });
  });
});

describe("isLogoDataUrl: the only src a logo may have", () => {
  it("accepts base64 image data URLs of the four types only", () => {
    const png = toLogoDataUrl("image/png", b64(makePng(32, 32)));
    expect(isLogoDataUrl(png)).toBe(true);
    for (const bad of [
      "https://evil.example/logo.png",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml,<svg onload=alert(1)>",
      "data:image/svg+xml;utf8,<svg/>",
      "data:image/gif;base64,R0lGODlh",
      "blob:https://app/123",
      `${png}"onerror="alert(1)`,
      "data:image/png;base64,abc",
      null,
      42,
    ]) {
      expect(isLogoDataUrl(bad)).toBe(false);
    }
  });

  it("refuses data URLs larger than the stored budget", () => {
    expect(isLogoDataUrl(`data:image/png;base64,${"A".repeat(200_000)}`)).toBe(false);
  });

  it("round-trips base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(base64ToBytes("A")).toBeNull();
  });
});
