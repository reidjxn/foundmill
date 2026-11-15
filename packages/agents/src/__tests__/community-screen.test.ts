/**
 * The shared deterministic screen (`communityScreenLocalFlags`): community posts and names, project pages and person
 * profiles all go through it. What a person writes to get an address or a number past it is caught; ordinary text with
 * years, prices and counts is not.
 */
import { BIDI_CONTROL_RE, hasBidiControl } from "@foundmill/config";
import { describe, expect, it } from "vitest";
import { communityScreenLocalFlags, screenText } from "../community-screen";

const flags = (text: string) => communityScreenLocalFlags(text);
const ZWSP = "\u200b";
const ZWJ = "\u200d";
const SOFT_HYPHEN = "\u00ad";
const RLO = "\u202e";
const LRI = "\u2066";
const PDI = "\u2069";
const fullwidth = (s: string) => [...s].map((c) => (c >= "!" && c <= "~" ? String.fromCodePoint(c.codePointAt(0)! + 0xfee0) : c)).join("");

describe("community screen: what is held", () => {
  it("plain email addresses, phone numbers and markup, as before", () => {
    expect(flags("Mail me at ana@example.com")).toEqual(["personal_data"]);
    expect(flags("Call +44 7700 900123")).toEqual(["personal_data"]);
    expect(flags("Text me: 555 123 4567")).toEqual(["personal_data"]);
    expect(flags("(555) 201-3344")).toEqual(["personal_data"]);
    expect(flags("<iframe src=x>")).toEqual(["markup"]);
    expect(flags("javascript:alert(1)")).toEqual(["markup"]);
  });

  it("format characters hidden inside an address, a number or a script link", () => {
    expect(flags(`ana${ZWSP}@example.com`)).toEqual(["personal_data"]);
    expect(flags(`ana@exa${ZWJ}mple${SOFT_HYPHEN}.com`)).toEqual(["personal_data"]);
    expect(flags(`555${ZWSP}201${ZWSP}3344`)).toEqual(["personal_data"]);
    expect(flags(`java${ZWSP}script:alert(1)`)).toEqual(["markup"]);
    expect(flags(`<scr${ZWSP}ipt>`)).toEqual(["markup"]);
    // A bidi override that shows the address backwards is still the address underneath.
    expect(flags(`write to ${RLO}ana@example.com`)).toEqual(["personal_data"]);
    expect(flags(`${LRI}ana@example.com${PDI}`)).toEqual(["personal_data"]);
    expect(screenText(`a${ZWSP}b${RLO}c`)).toBe("abc");
  });

  it("fullwidth forms (folded by NFKC)", () => {
    expect(flags("ana\uff20example.com")).toEqual(["personal_data"]);
    expect(flags(fullwidth("ana@example.com"))).toEqual(["personal_data"]);
    expect(flags(fullwidth("5552013344"))).toEqual(["personal_data"]);
    expect(flags(fullwidth("javascript:"))).toEqual(["markup"]);
  });

  it("an address written out with [at], (at), at, [dot] or dot", () => {
    for (const text of [
      "name [at] example dot com",
      "name [at] example [dot] com",
      "name (at) example (dot) co (dot) uk",
      "name(at)example.com",
      "name {at} example.com",
      "name at example dot com",
      "Write to Ana at gmail dot com",
      "name@example dot com",
      "name @ example [dot] com",
      "NAME [AT] EXAMPLE DOT COM",
    ]) {
      expect(flags(text), text).toEqual(["personal_data"]);
    }
  });

  it("runs of nine or more digits, with spaces, dots or dashes between them", () => {
    for (const text of ["5552013344", "Call 07700 900123", "07700900123", "555.201.3344", "555-201-3344", "555 - 201 - 3344", "+1 555 201 3344", "My number is 0 7 7 0 0 9 0 0 1 2 3", "123456789"]) {
      expect(flags(text), text).toEqual(["personal_data"]);
    }
  });

  it("a seven-digit local number with a dash", () => {
    expect(flags("Call 555-1234")).toEqual(["personal_data"]);
    expect(flags("555-1234 after 6")).toEqual(["personal_data"]);
  });
});

describe("community screen: ordinary text is left alone", () => {
  it("years, prices, counts, ranges, dates and times", () => {
    for (const text of [
      "We grew 12% last month",
      "Started in 2026",
      "From 2019 to 2026",
      "2019-2026",
      "We raised $2,300 from 300 people",
      "Revenue: $1,234,567 in 2026",
      "£12,000,000 market",
      "300 people came, 120 bought",
      "It takes 3 to 5 days",
      "Oct 7 – 21, 2026",
      "Wed, Oct 7 at 3:45 PM",
      "11/11/2026",
      "2026-11-11",
      "Version 1.2.3",
      "Open 9-5, Monday to Friday",
      "Batch 12345678",
      "10 000 000 visitors",
      "Room 101-B",
    ]) {
      expect(flags(text), text).toEqual([]);
    }
  });

  it("prose with 'at' and 'dot', and an @ handle that is not an address", () => {
    for (const text of [
      "Look at this. Then try again.",
      "Meet me at noon. Bring snacks.",
      "I'm @ home. Back soon.",
      "Follow @anabakes on the socials",
      "Polka dot dresses at the market",
      "Connect the dots at the end",
      "We sell at markets, dot by dot",
    ]) {
      expect(flags(text), text).toEqual([]);
    }
  });
});

describe("names: bidi controls", () => {
  it("refuses embedding, override and isolate controls, and nothing else", () => {
    for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) expect(hasBidiControl(`Ana${String.fromCodePoint(cp)}Ruiz`), cp.toString(16)).toBe(true);
    expect(hasBidiControl("Ana Ruiz")).toBe(false);
    expect(hasBidiControl("José Núñez")).toBe(false);
    expect(hasBidiControl("محمد")).toBe(false);
    expect(BIDI_CONTROL_RE.test("\u200f")).toBe(false);
  });
});
