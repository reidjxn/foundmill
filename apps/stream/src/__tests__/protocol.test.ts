import { describe, expect, it } from "vitest";
import { eventFrame } from "../connection";
import { parseClientFrame } from "../frames";
import { BEARER_PROTOCOL_PREFIX, businessChannel, isAuthedFrame, isErrorFrame, isEventFrame, isPongFrame, isSubscribedFrame, parseChannel, sessionChannel, STREAM_SUBPROTOCOL, streamProtocols, tokenExpiry, tokenFromProtocols, userChannel } from "../protocol";
import { BUSINESS_A, SESSION_A } from "./helpers";

describe("protocol", () => {
  it("parses ev:/as: channels with uuid ids and rejects anything else", () => {
    expect(parseChannel(businessChannel(BUSINESS_A))).toEqual({ kind: "business", id: BUSINESS_A, streamKey: `ev:${BUSINESS_A}` });
    expect(parseChannel(sessionChannel(SESSION_A))).toEqual({ kind: "session", id: SESSION_A, streamKey: `as:${SESSION_A}` });
    expect(parseChannel(userChannel(BUSINESS_A))).toEqual({ kind: "user", id: BUSINESS_A, streamKey: `u:${BUSINESS_A}` });
    expect(parseChannel("u:someone")).toBeNull();
    expect(parseChannel("ev:not-a-uuid")).toBeNull();
    expect(parseChannel(`dlq:${BUSINESS_A}`)).toBeNull();
    expect(parseChannel(`ev:${BUSINESS_A} `)).toBeNull();
    expect(parseChannel(`ev:*`)).toBeNull();
    expect(parseChannel(42)).toBeNull();
    expect(parseChannel(null)).toBeNull();
  });

  it("validates inbound frames exactly as ARCHITECTURE §12 defines them (plus the focus and auth extensions)", () => {
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
    expect(parseClientFrame(JSON.stringify({ t: "auth", token: "a.b.c" }))).toEqual({ ok: true, frame: { t: "auth", token: "a.b.c" } });
    expect(parseClientFrame(JSON.stringify({ t: "auth", token: "" })).ok).toBe(false);
    expect(parseClientFrame(`{"t":"ping","pad":"${"x".repeat(9000)}"}`)).toEqual({ ok: false, reason: "frame too large" });
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
    expect(isSubscribedFrame({ t: "subscribed", ch: businessChannel(BUSINESS_A) })).toBe(true);
    expect(isSubscribedFrame({ t: "subscribed" })).toBe(false);
    expect(isEventFrame({ t: "subscribed", ch: businessChannel(BUSINESS_A) })).toBe(false);
    expect(isAuthedFrame({ t: "authed", exp: 1 })).toBe(true);
    expect(isAuthedFrame({ t: "pong" })).toBe(false);
  });

  it("carries the token in a subprotocol, never the URL, and reads it back (SEC-12)", () => {
    expect(streamProtocols("")).toEqual([STREAM_SUBPROTOCOL]);
    expect(streamProtocols(null)).toEqual([STREAM_SUBPROTOCOL]);
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln-_";
    const [own, bearer] = streamProtocols(jwt);
    expect(own).toBe(STREAM_SUBPROTOCOL);
    // A subprotocol must be an HTTP token: no ":" (dev tokens), "/" "+" "=" (base64) or spaces.
    expect(bearer).toMatch(/^foundmill\.bearer\.[A-Za-z0-9_-]+$/);
    expect(bearer!.startsWith(BEARER_PROTOCOL_PREFIX)).toBe(true);
    expect(tokenFromProtocols(`${STREAM_SUBPROTOCOL}, ${bearer}`)).toBe(jwt);
    expect(tokenFromProtocols([STREAM_SUBPROTOCOL, bearer!])).toBe(jwt);
    expect(tokenFromProtocols(streamProtocols(`dev:${SESSION_A}`).join(", "))).toBe(`dev:${SESSION_A}`);
    expect(tokenFromProtocols(STREAM_SUBPROTOCOL)).toBeNull();
    expect(tokenFromProtocols(undefined)).toBeNull();
    expect(tokenFromProtocols(`${BEARER_PROTOCOL_PREFIX}not base64!`)).toBeNull();
  });

  it("reads a JWT's expiry without verifying it; dev tokens and garbage have none", () => {
    const payload = btoa(JSON.stringify({ sub: "x", exp: 1_800_000_000 })).replace(/=+$/, "");
    expect(tokenExpiry(`h.${payload}.s`)).toBe(1_800_000_000_000);
    expect(tokenExpiry(`h.${btoa(JSON.stringify({ sub: "x" }))}.s`)).toBeNull();
    expect(tokenExpiry("dev")).toBeNull();
    expect(tokenExpiry(`dev:${SESSION_A}`)).toBeNull();
    expect(tokenExpiry("a.%%%.c")).toBeNull();
    expect(tokenExpiry(null)).toBeNull();
  });
});
