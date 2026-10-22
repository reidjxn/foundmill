/**
 * Mock OpenAI Images: a deterministic placeholder portrait (a PNG drawn pixel by pixel: a smiling head-and-shoulders
 * silhouette on a color taken from the prompt), so INTEGRATIONS_MODE=mock runs the whole faces flow with no key and no
 * network. Same prompt, same bytes. It is obviously not a photograph, which is the honest mock.
 */
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord } from "../../mock-utils";
import { OPENAI_IMAGES_KEY, OPENAI_IMAGES_RATE_LIMITS, openaiImagesTools } from "./tools";

/** The model id the mock reports, so a stored mock portrait is recognizable as one. */
export const MOCK_IMAGE_MODEL = "mock-portrait";
const SIZE = 192;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** hsl (h 0-360, s and l 0-1) to 0-255 rgb. */
function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** A small valid PNG (8-bit RGB) of a smiling silhouette; the hue and skin tone come from the prompt's hash. */
export function placeholderPortraitPng(seed: string): Buffer {
  const digest = createHash("sha256").update(seed).digest();
  const hue = ((digest[0]! << 8) | digest[1]!) % 360;
  const bg = hsl(hue, 0.35, 0.82);
  const shirt = hsl((hue + 160) % 360, 0.35, 0.42);
  const skin = hsl(20 + (digest[2]! % 20), 0.45, 0.4 + (digest[3]! % 40) / 100);
  const dark: [number, number, number] = [60, 40, 40];
  const cx = SIZE / 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 3);
    for (let x = 0; x < SIZE; x++) {
      let px = bg;
      const body = ((x - cx) / (SIZE * 0.42)) ** 2 + ((y - SIZE * 1.02) / (SIZE * 0.34)) ** 2 <= 1;
      const head = ((x - cx) / (SIZE * 0.2)) ** 2 + ((y - SIZE * 0.4) / (SIZE * 0.25)) ** 2 <= 1;
      if (body) px = shirt;
      if (head) px = skin;
      if (head) {
        const eye = [cx - SIZE * 0.08, cx + SIZE * 0.08].some((ex) => (x - ex) ** 2 + (y - SIZE * 0.36) ** 2 <= (SIZE * 0.02) ** 2);
        // The smile: the lower half of a ring under the eyes.
        const d = Math.hypot(x - cx, y - SIZE * 0.4);
        const smile = y > SIZE * 0.44 && d > SIZE * 0.1 && d < SIZE * 0.12 && Math.abs(x - cx) < SIZE * 0.1;
        if (eye || smile) px = dark;
      }
      const o = 1 + x * 3;
      row[o] = px[0];
      row[o + 1] = px[1];
      row[o + 2] = px[2];
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

export const openaiImagesMock = buildMockConnector({
  key: OPENAI_IMAGES_KEY,
  displayName: "OpenAI Images",
  phase: 1,
  auth: { kind: "api_key", platformKey: true },
  tools: openaiImagesTools,
  rateLimits: OPENAI_IMAGES_RATE_LIMITS,
  now: () => MOCK_NOW,
  handlers: {
    generate_image: async ({ prompt, size, quality }) => ({ mime: "image/png" as const, base64: placeholderPortraitPng(`${size}:${quality}:${prompt}`).toString("base64"), model: MOCK_IMAGE_MODEL }),
  },
  connect: async (businessId) => mockIntegrationRecord(OPENAI_IMAGES_KEY, businessId, { accountLabel: "OpenAI Images (platform, mock)" }),
  healthcheck: async () => mockHealth(OPENAI_IMAGES_KEY),
});
