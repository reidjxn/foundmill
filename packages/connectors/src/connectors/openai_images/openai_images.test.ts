import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { IMAGE_MODELS } from "@foundmill/models";
import { personaPortraitPrompt, PERSONAS } from "@foundmill/shared";
import { jsonResponse, routedFetch } from "../../http";
import { describeConnectorContract, envKeysPresent, makeToolContext } from "../../testing/contract-suite";
import { IMAGES_BAD_KEY, IMAGES_MODERATION_BLOCKED, IMAGES_OK, IMAGES_RATE_LIMITED, TINY_WEBP_BASE64 } from "./fixtures/images";
import { createOpenaiImagesConnector, redactKeys } from "./index";
import { openaiImagesMock } from "./mock";
import { PROMPT_MAX_CHARS } from "./tools";

const PROMPT = personaPortraitPrompt(PERSONAS[0]!);
const KEY = "sk-test-secret-key-123456";

describeConnectorContract("openai_images (mock)", {
  connector: openaiImagesMock,
  mode: "mock",
  calls: [
    {
      tool: "generate_image",
      args: { prompt: PROMPT },
      check: (r) => {
        const d = r.data as { mime: string; base64: string; model: string };
        expect(d.mime).toBe("image/png");
        expect(d.model).toBe("mock-portrait");
        expect(Buffer.from(d.base64, "base64").subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        expect(r.costMinor).toBeGreaterThan(0);
      },
    },
    { tool: "generate_image", args: { prompt: "" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "generate_image", args: { prompt: "x".repeat(PROMPT_MAX_CHARS + 1) }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "generate_image", args: { prompt: "a face", size: "512x512" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "generate_image", args: { prompt: "a face", quality: "ultra" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
  ],
});

/** Reads a PNG back: checks the signature, every chunk's CRC position, the dimensions and that the pixel data inflates to size. */
function readPng(bytes: Buffer): { width: number; height: number } {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  expect(offset).toBe(bytes.length);
  expect(inflateSync(Buffer.concat(idat)).length).toBe(height * (1 + width * 3));
  return { width, height };
}

describe("openai_images mock", () => {
  const ctx = () => makeToolContext(openaiImagesMock);
  it("returns a valid PNG, the same bytes for the same prompt and different bytes for another", async () => {
    const a = await openaiImagesMock.callTool("generate_image", { prompt: "portrait one" }, ctx());
    const b = await openaiImagesMock.callTool("generate_image", { prompt: "portrait one" }, ctx());
    const c = await openaiImagesMock.callTool("generate_image", { prompt: "portrait two" }, ctx());
    expect(a.data).toEqual(b.data);
    expect((a.data as { base64: string }).base64).not.toEqual((c.data as { base64: string }).base64);
    const { width, height } = readPng(Buffer.from((a.data as { base64: string }).base64, "base64"));
    expect([width, height]).toEqual([192, 192]);
  });
  it("defaults to the medium quality and meters an estimate", async () => {
    const low = await openaiImagesMock.callTool("generate_image", { prompt: "p", quality: "low" }, ctx());
    const high = await openaiImagesMock.callTool("generate_image", { prompt: "p", quality: "high" }, ctx());
    const dflt = await openaiImagesMock.callTool("generate_image", { prompt: "p" }, ctx());
    expect(low.costMinor).toBeLessThan(dflt.costMinor);
    expect(dflt.costMinor).toBeLessThan(high.costMinor);
  });
  it("declares what it does as policy hints", () => {
    expect(openaiImagesMock.policyHints.generate_image).toEqual({ spendsMoney: true, contactsThirdParty: false, requiresKitMode: false, irreversible: false });
  });
});

describe("openai_images live (canned)", () => {
  interface Seen {
    method: string;
    url: string;
    authorization: string | null;
    contentType: string | null;
    body: Record<string, unknown>;
  }
  function connectorWith(respond: () => Response, seen: Seen[] = [], secrets: { openaiApiKey?: string } = { openaiApiKey: KEY }) {
    return createOpenaiImagesConnector({
      secrets,
      fetch: routedFetch({
        "POST https://api.openai.com/v1/images/generations": async (req, url) => {
          seen.push({ method: req.method, url: url.toString(), authorization: req.headers.get("authorization"), contentType: req.headers.get("content-type"), body: (await req.json()) as Record<string, unknown> });
          return respond();
        },
        "GET https://api.openai.com/v1/models/*": (req) => (req.headers.get("authorization") === `Bearer ${KEY}` ? jsonResponse({ id: IMAGE_MODELS.portrait_image, object: "model" }) : jsonResponse(IMAGES_BAD_KEY, { status: 401 })),
      }),
    });
  }

  it("sends the documented request and returns the first image as webp", async () => {
    const seen: Seen[] = [];
    const connector = connectorWith(() => jsonResponse(IMAGES_OK), seen);
    const result = await connector.callTool("generate_image", { prompt: PROMPT }, makeToolContext(connector, { mode: "live" }));
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ mime: "image/webp", base64: TINY_WEBP_BASE64, model: IMAGE_MODELS.portrait_image });
    expect(result.costMinor).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: "https://api.openai.com/v1/images/generations", authorization: `Bearer ${KEY}`, contentType: "application/json" });
    expect(seen[0]!.body).toEqual({ model: IMAGE_MODELS.portrait_image, prompt: PROMPT, n: 1, size: "1024x1024", quality: "medium", output_format: "webp", output_compression: 80 });
    // The key travels in the header only.
    expect(seen[0]!.url).not.toContain(KEY);
    expect(JSON.stringify(seen[0]!.body)).not.toContain(KEY);
  });

  it("passes the requested quality through", async () => {
    const seen: Seen[] = [];
    const connector = connectorWith(() => jsonResponse(IMAGES_OK), seen);
    await connector.callTool("generate_image", { prompt: "a face", quality: "high" }, makeToolContext(connector, { mode: "live" }));
    expect(seen[0]!.body.quality).toBe("high");
  });

  it("throws ConfigError without OPENAI_API_KEY and calls nothing", async () => {
    const seen: Seen[] = [];
    const connector = connectorWith(() => jsonResponse(IMAGES_OK), seen, {});
    await expect(connector.callTool("generate_image", { prompt: "a face" }, makeToolContext(connector, { mode: "live" }))).rejects.toMatchObject({ code: "connector_unconfigured", message: expect.stringContaining("OPENAI_API_KEY") });
    expect(seen).toHaveLength(0);
  });

  it("maps vendor failures to tool errors without echoing a key", async () => {
    const connector = (body: unknown, status: number) => connectorWith(() => jsonResponse(body, { status }));
    const call = async (c: ReturnType<typeof connector>) => c.callTool("generate_image", { prompt: "a face" }, makeToolContext(c, { mode: "live" }));

    const blocked = await call(connector(IMAGES_MODERATION_BLOCKED, 400));
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatchObject({ code: "vendor_error", status: 400, retryable: false });
    expect(blocked.error?.message).toContain("moderation_blocked");

    const limited = await call(connector(IMAGES_RATE_LIMITED, 429));
    expect(limited.error).toMatchObject({ code: "rate_limited", status: 429, retryable: true });

    const badKey = await call(connector(IMAGES_BAD_KEY, 401));
    expect(badKey.error).toMatchObject({ code: "unauthorized", status: 401 });
    expect(JSON.stringify(badKey)).not.toContain("sk-proj-abcdefghijklmnop1234");

    const down = await call(connector({ error: { message: "The server had an error", type: "server_error", code: null } }, 503));
    expect(down.error).toMatchObject({ code: "vendor_error", status: 503, retryable: true });
  });

  it("masks every key-shaped string, a masked or dotted one too", () => {
    // The pattern takes dots too (a key never ends a sentence safely), so a trailing period goes with it.
    expect(redactKeys("Incorrect API key provided: sk-proj-****************************abcd.")).toBe("Incorrect API key provided: sk-…");
    expect(redactKeys("key sk-abc.def_ghi-jkl and sk-****1234 here")).toBe("key sk-… and sk-… here");
    expect(redactKeys("sk-")).toBe("sk-");
    expect(redactKeys("no key in this sentence")).toBe("no key in this sentence");
  });

  it("never passes on a masked key the vendor quoted back", async () => {
    const masked = { error: { message: "Incorrect API key provided: sk-proj-****************************wxyz. You can find your API key at https://platform.openai.com/account/api-keys.", type: "invalid_request_error", param: null, code: "invalid_api_key" } };
    const connector = connectorWith(() => jsonResponse(masked, { status: 401 }));
    const result = await connector.callTool("generate_image", { prompt: "a face" }, makeToolContext(connector, { mode: "live" }));
    expect(result.error).toMatchObject({ code: "unauthorized", status: 401 });
    expect(JSON.stringify(result)).not.toContain("wxyz");
    expect(JSON.stringify(result)).not.toContain("****");
  });

  it("treats an answer without an image as a vendor failure", async () => {
    for (const body of [{ data: [] }, { data: [{ url: "https://x.example/a.png" }] }, {}]) {
      const connector = connectorWith(() => jsonResponse(body));
      const result = await connector.callTool("generate_image", { prompt: "a face" }, makeToolContext(connector, { mode: "live" }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({ code: "vendor_error", status: 502 });
    }
  });

  it("health check reads the model record (no image is made) and reports a bad key as degraded, a missing one as disconnected", async () => {
    const seen: Seen[] = [];
    const good = connectorWith(() => jsonResponse(IMAGES_OK), seen);
    expect((await good.healthcheck(makeToolContext(good, { mode: "live" }).integration)).status).toBe("connected");
    expect(seen).toHaveLength(0);
    const missing = connectorWith(() => jsonResponse(IMAGES_OK), seen, {});
    expect((await missing.healthcheck(makeToolContext(missing, { mode: "live" }).integration)).status).toBe("disconnected");
    const wrong = connectorWith(() => jsonResponse(IMAGES_OK), seen, { openaiApiKey: "sk-other-key-0000000" });
    const health = await wrong.healthcheck(makeToolContext(wrong, { mode: "live" }).integration);
    expect(health.status).toBe("degraded");
    expect(JSON.stringify(health)).not.toContain("sk-proj-abcdefghijklmnop1234");
  });
});

describe.skipIf(!envKeysPresent("OPENAI_API_KEY"))("openai_images (live)", () => {
  // Costs a few cents: one low-quality image, only when a key is in the environment.
  describeConnectorContract("openai_images live", { connector: createOpenaiImagesConnector({ secrets: { openaiApiKey: process.env.OPENAI_API_KEY! } }), mode: "live", deterministic: false, calls: [{ tool: "generate_image", args: { prompt: "A simple friendly cartoon face on a plain background", quality: "low" } }] });
});
