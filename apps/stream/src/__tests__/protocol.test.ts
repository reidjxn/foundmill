import { describe, expect, it } from "vitest";
import { eventFrame } from "../connection";
import { parseClientFrame } from "../frames";
import { businessChannel, isErrorFrame, isEventFrame, isPongFrame, parseChannel, sessionChannel } from "../protocol";
import { BUSINESS_A, SESSION_A } from "./helpers";

describe("protocol", () => {
  it("parses ev:/as: channels with uuid ids and rejects anything else", () => {
    expect(parseChannel(businessChannel(BUSINESS_A))).toEqual({ kind: "business", id: BUSINESS_A, streamKey: `ev:${BUSINESS_A}` });
    expect(parseChannel(sessionChannel(SESSION_A))).toEqual({ kind: "session", id: SESSION_A, streamKey: `as:${SESSION_A}` });
    expect(parseChannel("ev:not-a-uuid")).toBeNull();
    expect(parseChannel(`dlq:${BUSINESS_A}`)).toBeNull();
    expect(parseChannel(`ev:${BUSINESS_A} `)).toBeNull();
    expect(parseChannel(`ev:*`)).toBeNull();
    expect(parseChannel(42)).toBeNull();
    expect(parseChannel(null)).toBeNull();
  });

  it("validates inbound frames exactly as ARCHITECTURE §12 defines them (plus the focus extension)", () => {
    expect(parseClientFrame(JSON.stringify({ t: "sub", ch: "ev:x" }))).toEqual({ ok: true, frame: { t: "sub", ch: "ev:x" } });
    expect(parseClientFrame(JSON.stringify({ t: "sub", ch: "ev:x", focus: false }))).toEqual({ ok: true, frame: { t: "sub", ch: "ev:x", focus: false } });
    expect(parseClientFrame(JSON.stringify({ t: "unsub", ch: "as:y" }))).toEqual({ ok: true, frame: { t: "unsub", ch: "as:y" } });
    expect(parseClientFrame(JSON.stringify({ t: "ping" }))).toEqual({ ok: true, frame: { t: "ping" } });
    expect(parseClientFrame(JSON.stringify({ t: "focus", ch: "as:y", focused: true }))).toEqual({ ok: true, frame: { t: "focus", ch: "as:y", focused: true } });
    expect(parseClientFrame("not json").ok).toBe(false);
    expect(parseClientFrame(JSON.stringify({ t: "publish", ch: "ev:x" })).ok).toBe(false);
    expect(parseClientFrame(JSON.stringify({ t: "sub" })).ok).toBe(false);
    expect(parseClientFrame(JSON.stringify({ t: "sub", ch: "x".repeat(100) })).ok).toBe(false);
    expect(parseClientFrame(new TextEncoder().encode(JSON.stringify({ t: "ping" })))).toEqual({ ok: true, frame: { t: "ping" } });
    expect(parseClientFrame(`{"t":"ping","pad":"${"x".repeat(5000)}"}`)).toEqual({ ok: false, reason: "frame too large" });
  });

  it("splices event json into the frame without re-serialising it", () => {
    const json = '{"kind":"note","text":"hi \\"there\\""}';
    const frame = eventFrame("as:abc", json);
    expect(frame).toBe(`{"ch":"as:abc","e":${json}}`);
    expect(JSON.parse(frame)).toEqual({ ch: "as:abc", e: { kind: "note", text: 'hi "there"' } });
  });

  it("type guards recognise server frames", () => {
    expect(isEventFrame({ ch: "ev:x", e: {} })).toBe(true);
    expect(isEventFrame({ ch: "ev:x", e: null })).toBe(true);
    expect(isEventFrame({ t: "pong" })).toBe(false);
    expect(isPongFrame({ t: "pong" })).toBe(true);
    expect(isErrorFrame({ t: "err", code: "forbidden", message: "no" })).toBe(true);
    expect(isErrorFrame({ t: "err" })).toBe(false);
  });
});
