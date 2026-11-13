import { describe, expect, it } from "vitest";
import { formatVia, parseVia, VIA_MAX_LENGTH, withVia } from "./via";

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
});
