import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentStatusPill, StatusPill, agentStatusTone } from "./StatusPill";

describe("StatusPill", () => {
  it("always renders an icon and a word", () => {
    render(<StatusPill tone="good">Healthy</StatusPill>);
    const pill = screen.getByText("Healthy").closest("span[data-tone]") as HTMLElement;
    expect(pill.getAttribute("data-tone")).toBe("good");
    expect(pill.querySelector("svg")).not.toBeNull();
    expect(pill.className).toContain("text-status-good");
    expect(pill.className).toContain("bg-status-good/12");
  });
  it("falls back to a generic word per tone", () => {
    render(<StatusPill tone="bad" />);
    expect(screen.getByText("Failing")).toBeTruthy();
  });
  it("neutral uses the secondary text colour", () => {
    render(<StatusPill tone="neutral">Idle</StatusPill>);
    const pill = screen.getByText("Idle").closest("span[data-tone]") as HTMLElement;
    expect(pill.className).toContain("text-secondary");
  });
  it("maps every agent status", () => {
    expect(agentStatusTone("healthy").tone).toBe("good");
    expect(agentStatusTone("degraded").tone).toBe("warn");
    expect(agentStatusTone("failing").tone).toBe("bad");
    expect(agentStatusTone("injured").word).toBe("Down");
    expect(agentStatusTone("paused").tone).toBe("neutral");
    render(<AgentStatusPill status="idle" />);
    expect(screen.getByText("Idle")).toBeTruthy();
  });
});
