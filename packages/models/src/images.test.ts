import { describe, expect, it } from "vitest";
import { LiveModelClient } from "./client";
import { DesignReviewOutput } from "./design-review-schema";
import { ImageNotAllowedError, assertImagesAllowed, withoutImageData } from "./images";
import { MockModelClient } from "./mock";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const describedShot = {
  id: "s1",
  page: "/pricing",
  viewport: "phone",
  description: {
    page: "/pricing",
    viewport: "phone",
    widthPx: 390,
    scrollWidthPx: 480,
    elements: [
      { ref: "main > h1", role: "heading", level: 1, text: "Pricing", fontSizePx: 32, color: "#111111", background: "#ffffff" },
      { ref: "main > p", role: "text", text: "Lorem ipsum dolor sit amet", fontSizePx: 16, color: "#b0b0b0", background: "#ffffff", spacingPx: [13, 7, 18] },
    ],
  },
};

describe("images on a message (design check, item 13)", () => {
  it("are allowed only on the vision route, from the user, as base64 of a supported type", () => {
    const msg = [{ role: "user" as const, content: "Review these.", images: [{ mediaType: "image/png" as const, data: PNG }] }];
    expect(() => assertImagesAllowed("designReview", msg)).not.toThrow();
    expect(() => assertImagesAllowed("worker", msg)).toThrow(ImageNotAllowedError);
    expect(() => assertImagesAllowed("designReview", [{ role: "assistant", content: "x", images: msg[0]!.images }])).toThrow(/user messages/);
    expect(() => assertImagesAllowed("designReview", [{ role: "user", content: "x", images: [{ mediaType: "image/png", data: "not base64!" }] }])).toThrow(/base64/);
    expect(() => assertImagesAllowed("worker", [{ role: "user", content: "no images" }])).not.toThrow();
    expect(withoutImageData(msg)[0]!.images![0]!.data).toMatch(/^<image \d+ chars>$/);
  });

  it("the mock client refuses images on another route", async () => {
    const client = new MockModelClient();
    await expect(client.complete({ route: "worker", messages: [{ role: "user", content: "x", images: [{ mediaType: "image/png", data: PNG }] }] })).rejects.toBeInstanceOf(ImageNotAllowedError);
  });

  it("the mock reviewer flags what the page description proves and never judges a screenshot without one", async () => {
    const client = new MockModelClient();
    const content = "```json\n" + JSON.stringify({ screenshots: [describedShot, { id: "s2", page: "/", viewport: "desktop" }] }) + "\n```";
    const r = await client.complete({ route: "designReview", messages: [{ role: "user", content, images: [{ mediaType: "image/png", data: PNG }] }], schema: DesignReviewOutput });
    const principles = r.json.fixes.map((f) => f.principle);
    expect(principles).toEqual(expect.arrayContaining(["contrast", "real_content", "responsive", "spacing"]));
    expect(r.json.fixes.every((f) => f.shots.includes("s1") && f.page === "/pricing")).toBe(true);
    expect(r.json.fixes[0]!.severity).toBe("high");
    expect(r.json.unreadable).toEqual([{ shot: "s2", why: expect.stringMatching(/cannot judge/) }]);
  });
});

describe("the live client sends images as image blocks before the text", () => {
  it("on the design review route, and refuses them elsewhere before any call", async () => {
    const calls: Record<string, unknown>[] = [];
    const reply = { fixes: [], unreadable: [] };
    const fetchImpl = async (_input: unknown, init?: RequestInit): Promise<Response> => {
      calls.push(JSON.parse(init!.body as string) as Record<string, unknown>);
      const body = { id: "msg_test", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "request-id": "req_img" } });
    };
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch: fetchImpl as unknown as typeof globalThis.fetch, sleep: async () => {} });
    await client.complete({ route: "designReview", schema: DesignReviewOutput, messages: [{ role: "user", content: "Review.", images: [{ mediaType: "image/png", data: PNG }] }] });
    const content = (calls[0]!.messages as { content: { type: string; source?: unknown }[] }[])[0]!.content;
    expect(content.map((b) => b.type)).toEqual(["image", "text"]);
    expect(content[0]!.source).toEqual({ type: "base64", media_type: "image/png", data: PNG });
    await expect(client.complete({ route: "worker", messages: [{ role: "user", content: "x", images: [{ mediaType: "image/png", data: PNG }] }] })).rejects.toBeInstanceOf(ImageNotAllowedError);
    expect(calls).toHaveLength(1);
  });
});
