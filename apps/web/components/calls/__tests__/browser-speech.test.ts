import { describe, expect, it } from "vitest";
import { SPEECH_ACCENTS } from "@foundmill/shared/team-call";
import { audioMimeOf, estimateSpeakMs, pickBrowserVoice, pickRecorderMime, recognizerCtor, toDataUrl, utteranceTuning } from "../browser-speech";

const VOICES = [
  { name: "Samantha", lang: "en-US" },
  { name: "Karen", lang: "en-AU" },
  { name: "Alex", lang: "en-US" },
  { name: "Daniel", lang: "en-GB" },
  { name: "Thomas", lang: "fr-FR" },
];

describe("browser voice", () => {
  it("matches the accent's presentation, English and US first", () => {
    const woman = SPEECH_ACCENTS.find((a) => a.presentation === "woman")!.key;
    const man = SPEECH_ACCENTS.find((a) => a.presentation === "man")!.key;
    expect(pickBrowserVoice(VOICES, woman)?.name).toBe("Samantha");
    expect(pickBrowserVoice(VOICES, man)?.name).toBe("Alex");
  });
  it("is stable: an accent always gets the same voice", () => {
    expect(pickBrowserVoice(VOICES, "talia")).toBe(pickBrowserVoice(VOICES, "talia"));
  });
  it("falls back to any voice, and to null when there are none", () => {
    expect(pickBrowserVoice([{ name: "Zzz", lang: "de-DE" }], "talia")?.name).toBe("Zzz");
    expect(pickBrowserVoice([], "talia")).toBeNull();
  });
  it("tunes pitch and rate from the accent's fallback", () => {
    const talia = SPEECH_ACCENTS.find((a) => a.key === "talia")!;
    expect(utteranceTuning("talia")).toEqual(talia.fallback);
    expect(utteranceTuning("nobody")).toEqual({ pitch: 1, rate: 1 });
  });
});

describe("timing and recording helpers", () => {
  it("estimates speaking time at 150 words a minute, at least 600 ms", () => {
    expect(estimateSpeakMs("Hi")).toBe(600);
    expect(estimateSpeakMs(Array(150).fill("word").join(" "))).toBe(60_000);
  });
  it("builds a data URL", () => {
    expect(toDataUrl("audio/wav", "AAAA")).toBe("data:audio/wav;base64,AAAA");
  });
  it("records in opus webm where supported, else the next best", () => {
    expect(pickRecorderMime(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickRecorderMime((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecorderMime(() => false)).toBeNull();
  });
  it("maps a recorder type to one teamCall.transcribe accepts", () => {
    expect(audioMimeOf("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(audioMimeOf("audio/mp4")).toBe("audio/mp4");
    expect(audioMimeOf("video/webm")).toBeNull();
  });
  it("finds the recognizer under either name, else null", () => {
    class R {}
    expect(recognizerCtor({ webkitSpeechRecognition: R } as unknown as Window)).toBe(R);
    expect(recognizerCtor({ SpeechRecognition: R } as unknown as Window)).toBe(R);
    expect(recognizerCtor({} as Window)).toBeNull();
  });
});
