import { describe, expect, it } from "vitest";
import { postVisitVia } from "../PostVisitBeacon";

describe("the visit beacon", () => {
  it("sends only a shared post's code, never a page's, a person's or anything else", () => {
    expect(postVisitVia("?via=s.k3m7qa2xpw")).toBe("s.k3m7qa2xpw");
    expect(postVisitVia("?utm_source=x&via=s.k3m7qa2xpw")).toBe("s.k3m7qa2xpw");
    for (const search of ["", "?via=p.maple-bakes", "?via=u.maya", "?via=s.NOTACODE00", "?via=s.maple-bakes", "?via=", "?x=1"]) expect(postVisitVia(search), search).toBeNull();
  });
});
