import { describe, expect, it } from "vitest";
import { APP_NAME, freeDisplayName, isReservedName } from "../brand";

describe("names only the platform may use (audit GLS2F-06, LS2-04)", () => {
  it("refuses the product name however it is dressed", () => {
    const dressed = [
      APP_NAME,
      "foundmill",
      "FOUNDMILL SUPPORT",
      "Foundmill Support (audit spoof test)",
      "F0undmi11",
      "F0undm1ll",
      "Found-mill",
      "F o u n d m i l l",
      "Foundm\u0301ill", // an accent on a letter
      "Fo\u200bundmill", // a zero-width space
      "F\u043eundmill", // Cyrillic "o"
      "\u{1d405}\u{1d428}\u{1d42e}\u{1d427}\u{1d41d}\u{1d426}\u{1d422}\u{1d425}\u{1d425}", // mathematical bold
      "Ana at Foundmill",
    ];
    for (const name of dressed) {
      expect(isReservedName(name), name).toBe(true);
      expect(isReservedName(name, "subject"), name).toBe(true);
    }
  });

  it("refuses a staff word as a word of a display name", () => {
    for (const name of ["Support", "support team", "Ana (Support)", "Admin", "The Moderator", "Staff", "Official Helpdesk", "Supp0rt"]) expect(isReservedName(name), name).toBe(true);
  });

  it("refuses a subject that opens with a staff word, but not one that merely mentions it", () => {
    expect(isReservedName("Support: verify your account", "subject")).toBe(true);
    expect(isReservedName("Admin notice", "subject")).toBe(true);
    expect(isReservedName("Anyone want to support my launch?", "subject")).toBe(false);
    expect(isReservedName("Intro: Ana and Ben", "subject")).toBe(false);
  });

  it("lets ordinary names through", () => {
    for (const name of ["Ana Núñez", "Avery Demo", "Ivy Intruder", "Reid", "Founder", "Sam Supporter", "Mill Hill Founders"]) expect(isReservedName(name), name).toBe(false);
  });

  it("freeDisplayName keeps a free name and falls back for a reserved or empty one", () => {
    expect(freeDisplayName("reid")).toBe("reid");
    expect(freeDisplayName("support")).toBe("Founder");
    expect(freeDisplayName("foundmill.team")).toBe("Founder");
    expect(freeDisplayName(undefined)).toBe("Founder");
    expect(freeDisplayName("  ", "Someone")).toBe("Someone");
  });
});
