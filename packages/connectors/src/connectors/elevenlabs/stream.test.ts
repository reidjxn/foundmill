import { describe, expect, it } from "vitest";
import { ConfigError, VendorError } from "../../contract";
import { createElevenlabsSpeechStreamer } from "./stream";
import { SPEECH_ACCENT_IDS } from "./speech-accents";

const KEY = "sk_test0123456789abcdef";

function fakeFetch(answer: () => Response, seen: { url?: string; init?: RequestInit }[] = []) {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
}

const audio = () =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([0xff, 0xf3, 1, 2]));
        c.enqueue(new Uint8Array([3, 4]));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "audio/mpeg" } },
  );

describe("ElevenLabs speech streamer", () => {
  it("asks the streaming endpoint with the accent's voice id, the key in the header only, and passes the bytes on as they come", async () => {
    const seen: { url?: string; init?: RequestInit }[] = [];
    const streamer = createElevenlabsSpeechStreamer({ secrets: { elevenlabsApiKey: KEY } as never, fetch: fakeFetch(audio, seen) as never });
    const out = await streamer.stream({ speechAccent: "talia", text: "Hello there." });
    expect(seen[0]!.url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${SPEECH_ACCENT_IDS.talia}/stream?output_format=mp3_44100_64`);
    expect(seen[0]!.url).not.toContain(KEY);
    expect((seen[0]!.init!.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
    expect(JSON.parse(String(seen[0]!.init!.body))).toMatchObject({ text: "Hello there.", model_id: "eleven_flash_v2_5" });
    expect(out).toMatchObject({ mime: "audio/mpeg", characters: 12 });
    const bytes = new Uint8Array(await new Response(out.body).arrayBuffer());
    expect([...bytes]).toEqual([0xff, 0xf3, 1, 2, 3, 4]);
  });

  it("refuses without a key, an unknown accent, a vendor refusal (status kept, key never quoted) and a non-audio answer", async () => {
    await expect(createElevenlabsSpeechStreamer({ secrets: {} as never, fetch: fakeFetch(audio) as never }).stream({ speechAccent: "talia", text: "x" })).rejects.toBeInstanceOf(ConfigError);
    const ok = createElevenlabsSpeechStreamer({ secrets: { elevenlabsApiKey: KEY } as never, fetch: fakeFetch(audio) as never });
    await expect(ok.stream({ speechAccent: "nobody", text: "x" })).rejects.toBeInstanceOf(VendorError);
    const refused = createElevenlabsSpeechStreamer({ secrets: { elevenlabsApiKey: KEY } as never, fetch: fakeFetch(() => new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: `quota for ${KEY}` } }), { status: 401, headers: { "content-type": "application/json" } })) as never });
    const err = await refused.stream({ speechAccent: "talia", text: "x" }).catch((e: unknown) => e as VendorError);
    expect(err).toBeInstanceOf(VendorError);
    expect((err as VendorError).httpStatus).toBe(401);
    expect((err as Error).message).not.toContain(KEY);
    const text = createElevenlabsSpeechStreamer({ secrets: { elevenlabsApiKey: KEY } as never, fetch: fakeFetch(() => new Response("oops", { status: 200, headers: { "content-type": "text/plain" } })) as never });
    await expect(text.stream({ speechAccent: "talia", text: "x" })).rejects.toBeInstanceOf(VendorError);
  });
});
