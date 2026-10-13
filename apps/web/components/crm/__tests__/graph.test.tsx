import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { RelationshipGraph, layoutRing } from "../RelationshipGraph";

describe("RelationshipGraph", () => {
  it("lays nodes on a ring starting at the top", () => {
    const pts = layoutRing(4, 100, 100, 50);
    expect(pts[0]!.x).toBeCloseTo(100);
    expect(pts[0]!.y).toBeCloseTo(50);
    expect(pts[1]!.x).toBeCloseTo(150);
    expect(pts[1]!.y).toBeCloseTo(100);
  });
  it("renders one edge and one node per relationship, with strength in the accessible label, and opens on click", () => {
    const onOpen = vi.fn();
    const r = render(
      <RelationshipGraph
        centre={{ id: "e1", name: "Acme Skincare", kind: "organisation" }}
        nodes={[
          { id: "p1", name: "Ana Lind", kind: "person", type: "works_at", strength: 14 },
          { id: "a1", name: "Mara", kind: "agent", type: "owner", strength: 18 },
        ]}
        onOpen={onOpen}
      />,
    );
    expect(r.container.querySelectorAll("line")).toHaveLength(2);
    const node = r.getByRole("button", { name: /Mara, Agent, owner, strength 18 of 20/ });
    fireEvent.click(node);
    expect(onOpen).toHaveBeenCalledWith("a1");
    expect(r.container.querySelector("[data-relationship-graph]")?.getAttribute("data-nodes")).toBe("2");
    // Buttons are never nested in an image: with clickable nodes the drawing is a named group.
    expect(r.getByRole("group", { name: "Acme Skincare: 2 relationships" })).toBeTruthy();
    expect(r.queryByRole("img")).toBeNull();
  });
  it("is one image when nothing in it is interactive", () => {
    const r = render(<RelationshipGraph centre={{ id: "e1", name: "Acme Skincare", kind: "organisation" }} nodes={[{ id: "p1", name: "Ana Lind", kind: "person", type: "works_at", strength: 14 }]} />);
    expect(r.getByRole("img", { name: "Acme Skincare: 1 relationship" })).toBeTruthy();
    expect(r.queryByRole("button")).toBeNull();
  });
});
