import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar, deptPalette, generateAvatar, ringForStatus } from "./Avatar";

describe("generateAvatar", () => {
  it("is deterministic and seed-sensitive", () => {
    const a = generateAvatar({ seed: "agent-7", dept: "dept-2" });
    expect(a).toBe(generateAvatar({ seed: "agent-7", dept: "dept-2" }));
    expect(a).not.toBe(generateAvatar({ seed: "agent-8", dept: "dept-2" }));
  });
  it("draws three to five shapes from the department palette with no colour literals", () => {
    const svg = generateAvatar({ seed: "agent-7", dept: "dept-5" });
    const m = svg.match(/data-avatar-shapes="(\d)"/);
    const count = Number(m?.[1]);
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(5);
    expect(svg).toContain("var(--dept-5)");
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it("derives four tones per department", () => {
    expect(deptPalette("dept-1")).toHaveLength(4);
    expect(deptPalette("dept-1")[0]).toBe("var(--dept-1)");
  });
});

describe("Avatar", () => {
  it("renders a human with initials and a label", () => {
    render(<Avatar name="Ada Lovelace" size={32} />);
    const el = screen.getByRole("img", { name: "Ada Lovelace" });
    expect(el.textContent).toBe("AL");
  });
  it("renders an agent portrait with a status ring word", () => {
    render(<Avatar name="Scout" agent={{ seed: "s1", dept: "dept-3" }} status="healthy" />);
    const el = screen.getByRole("img", { name: "Scout, healthy" });
    expect(el.getAttribute("data-ring")).toBe("good");
    expect(el.querySelector("svg")).not.toBeNull();
  });
  it("maps statuses to rings", () => {
    expect(ringForStatus("healthy")).toBe("good");
    expect(ringForStatus("degraded")).toBe("warn");
    expect(ringForStatus("paused")).toBe("warn");
    expect(ringForStatus("failing")).toBe("bad");
    expect(ringForStatus("injured")).toBe("bad");
    expect(ringForStatus("idle")).toBe("idle");
    expect(ringForStatus(undefined)).toBe("none");
  });
});
