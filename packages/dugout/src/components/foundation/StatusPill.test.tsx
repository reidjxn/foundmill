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
    // The tone's 12 % fill and 30 % ring (controls.css chip-tone) read --tone, set by tone-status-good.
    expect(pill.className).toContain("chip-tone");
    expect(pill.className).toContain("tone-status-good");
    expect(pill.className).toContain("border");
  });
  it("is a 22 px, fully round, sentence-case pill that wraps instead of truncating", () => {
    render(<StatusPill tone="warn">Waiting on the supplier's carton proof</StatusPill>);
    const pill = screen.getByText("Waiting on the supplier's carton proof").closest("span[data-tone]") as HTMLElement;
    expect(pill.className).toContain("min-h-chip");
    expect(pill.className).toContain("rounded-pill");
    expect(pill.className).not.toMatch(/\buppercase\b|\btruncate\b/);
    expect(screen.getByText("Waiting on the supplier's carton proof").className).toContain("break-words");
  });
  it("pulses in its own tone, never the brand", () => {
    render(
      <StatusPill tone="bad" pulse>
        Respond
      </StatusPill>,
    );
    const pill = screen.getByText("Respond").closest("span[data-tone]") as HTMLElement;
    expect(pill.className).toContain("animate-ring-pulse");
    expect(pill.className).toContain("tone-status-bad");
    expect(pill.getAttribute("data-pulse")).toBe("true");
  });
  it("fits a tight cell with fit, and keeps a caller's fixed height", () => {
    render(
      <StatusPill tone="info" fit className="h-badge">
        Scheduled
      </StatusPill>,
    );
    const pill = document.querySelector("span[data-tone]") as HTMLElement;
    expect(pill.querySelector("[data-fit-box]")).not.toBeNull();
    expect(pill.className).toContain("h-badge");
    expect(pill.className).not.toContain("min-h-chip");
  });
  it("falls back to a generic word per tone", () => {
    render(<StatusPill tone="bad" />);
    expect(screen.getByText("Failing")).toBeTruthy();
  });
  it("neutral uses the secondary text colour", () => {
    render(<StatusPill tone="neutral">Idle</StatusPill>);
    const pill = screen.getByText("Idle").closest("span[data-tone]") as HTMLElement;
    expect(pill.className).toContain("text-secondary");
    expect(pill.className).toContain("tone-secondary");
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
