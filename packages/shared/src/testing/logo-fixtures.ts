/**
 * Test fixtures for logo validation: real PNG files (zlib-compressed, so browsers decode them) and structurally valid
 * JPEG and WebP headers. Node-only; imported by tests in shared, the api and the evals, never by product code.
 */
import { crc32, deflateSync } from "node:zlib";

/** A real PNG (RGBA, one solid colour) built with zlib, so the sniffer is tested against a file browsers decode. */
export function makePng(width: number, height: number, rgba: [number, number, number, number] = [27, 79, 216, 255], opts: { noise?: boolean } = {}): Uint8Array {
  const row = Buffer.alloc(1 + width * 4);
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) {
    raw[y * row.length] = 0;
    for (let x = 0; x < width; x++) {
      const o = y * row.length + 1 + x * 4;
      const n = opts.noise ? (x * 7919 + y * 104729) % 251 : 0;
      raw[o] = (rgba[0] + n) & 255;
      raw[o + 1] = (rgba[1] + n * 3) & 255;
      raw[o + 2] = (rgba[2] + n * 5) & 255;
      raw[o + 3] = rgba[3];
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

/** A structurally valid baseline JPEG header (SOI, APP0, SOF0 with the size, SOS, a little data, EOI). */
export function makeJpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34, 0x56];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, ...sos, 0xff, 0xd9]);
}

/** A lossless (VP8L) WebP header with the size and a few payload bytes. */
export function makeWebp(width: number, height: number): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14) | (1 << 28);
  const payload = [0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255, 0, 0, 0];
  const vp8l = [..."VP8L"].map((c) => c.charCodeAt(0));
  const chunkLen = [payload.length, 0, 0, 0];
  const body = [..."WEBP"].map((c) => c.charCodeAt(0)).concat(vp8l, chunkLen, payload);
  const size = body.length;
  return new Uint8Array([..."RIFF"].map((c) => c.charCodeAt(0)).concat([size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >> 24) & 255], body));
}
