import { describe, expect, it } from "vitest";
import { ATTRIBUTION_VIA_KINDS, formatVia, isPostCode, parseVia, POST_CODE_LENGTH, VIA_KINDS, VIA_MAX_LENGTH, VIA_PARAM, withVia } from "./via";

describe("via references", () => {
  it("round-trips a project page and a person", () => {
    expect(formatVia({ kind: "project_page", ref: "maple-bakes" })).toBe("p.maple-bakes");
    expect(parseVia("p.maple-bakes")).toEqual({ kind: "project_page", ref: "maple-bakes" });
    expect(parseVia("u.maya")).toEqual({ kind: "person_profile", ref: "maya" });
  });

  it("drops anything that is not a reference, without throwing", () => {
    for (const bad of [undefined, null, 7, "", "p", "p.", "p.ab", "x.maple", "p.Maple", "p.-maple", "p.maple-", "p.ma ple", "pp.maple", "p.maple?x=1", "p.<script>", `p.${"a".repeat(41)}`]) {
      expect(parseVia(bad)).toBeNull();
    }
    expect(parseVia(`p.${"a".repeat(40)}`)).not.toBeNull();
    expect(`p.${"a".repeat(40)}`.length).toBe(VIA_MAX_LENGTH);
  });

  it("adds the reference to a path or a URL and keeps what was there", () => {
    const ref = { kind: "project_page", ref: "maple-bakes" } as const;
    expect(withVia("/", ref)).toBe("/?via=p.maple-bakes");
    expect(withVia("/start?door=idea", ref)).toBe("/start?door=idea&via=p.maple-bakes");
    expect(withVia("/?via=u.someone#top", ref)).toBe("/?via=p.maple-bakes#top");
    expect(withVia("https://foundmill.example/p/x/story", ref)).toBe("https://foundmill.example/p/x/story?via=p.maple-bakes");
  });

  it("round-trips a shared post's code, which has its own shape", () => {
    expect(formatVia({ kind: "post", ref: "k3m7qa2xpw" })).toBe("s.k3m7qa2xpw");
    expect(parseVia("s.k3m7qa2xpw")).toEqual({ kind: "post", ref: "k3m7qa2xpw" });
    expect(parseVia(formatVia({ kind: "post", ref: "abcdefgh27" }))).toEqual({ kind: "post", ref: "abcdefgh27" });
    // Not a code: wrong length, a digit outside 2-7, upper case, a hyphen, a slug-like word.
    for (const bad of ["s.k3m7qa2xp", "s.k3m7qa2xpwq", "s.k3m7qa2x0w", "s.k3m7qa2x8w", "s.K3M7QA2XPW", "s.k3m7-a2xpw", "s.maple-bakes", "s.abc"]) expect(parseVia(bad), bad).toBeNull();
    expect(isPostCode("k3m7qa2xpw")).toBe(true);
    expect(isPostCode("k3m7qa2xp1")).toBe(false);
    expect(POST_CODE_LENGTH).toBe(10);
  });

  it("keeps exactly one via when a post's code replaces the page's", () => {
    const page = withVia("https://foundmill.example/p/maple-bakes", { kind: "project_page", ref: "maple-bakes" });
    const shared = withVia(page, { kind: "post", ref: "k3m7qa2xpw" });
    expect(shared).toBe("https://foundmill.example/p/maple-bakes?via=s.k3m7qa2xpw");
    expect(new URL(shared).searchParams.getAll(VIA_PARAM)).toEqual(["s.k3m7qa2xpw"]);
  });

  it("records only pages and people in attributions: a post code is not one of them", () => {
    expect([...ATTRIBUTION_VIA_KINDS]).toEqual(["project_page", "person_profile"]);
    expect([...VIA_KINDS]).toEqual(["project_page", "person_profile", "post"]);
  });
});
