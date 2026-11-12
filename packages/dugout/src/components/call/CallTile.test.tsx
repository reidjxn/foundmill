import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { AgentPersonaProvider, createAgentPersonaApi } from "../foundation/AgentPersona";
import { CallTile } from "./CallTile";
import { participantIdentity } from "./identity";
import { FOUNDER_NAME, TEAM_CALL_AGENTS, portraitDataUrl } from "./fixtures";

const cos = TEAM_CALL_AGENTS[0]!;
const product = TEAM_CALL_AGENTS[1]!;

const on = (ui: ReactElement) => render(<AgentPersonaProvider anthropomorphic style="humans" portraitUrl={portraitDataUrl}>{ui}</AgentPersonaProvider>);
const off = (ui: ReactElement) => render(<AgentPersonaProvider anthropomorphic={false}>{ui}</AgentPersonaProvider>);

describe("CallTile: the same agent as everywhere else", () => {
  it("persona on: the persona name, the role and the portrait URL portraitFor gives", () => {
    const api = createAgentPersonaApi({ anthropomorphic: true, style: "humans", portraitUrl: portraitDataUrl });
    const identity = participantIdentity(product);
    const { container } = on(<CallTile participant={product} />);
    expect(screen.getByTestId("call-name").textContent).toBe(api.nameFor(identity));
    expect(screen.getByTestId("call-name").textContent).toBe("Priya");
    expect(screen.getByTestId("call-role").textContent).toBe(api.positionFor(identity));
    expect(screen.getByTestId("call-role").textContent).toBe("Product Lead");
    const img = container.querySelector<HTMLImageElement>('img[data-avatar="photo"]');
    expect(img?.getAttribute("src")).toBe(api.portraitFor(identity));
    expect(img?.getAttribute("src")).toBe(portraitDataUrl("priya"));
    expect(screen.getByText("AI agent")).toBeTruthy();
  });

  it("persona off: the stored name and the drawn portrait, no photo", () => {
    const { container } = off(<CallTile participant={product} />);
    expect(screen.getByTestId("call-name").textContent).toBe("Product Lead");
    // The role would only repeat the name, so it is not shown twice.
    expect(screen.queryByTestId("call-role")).toBeNull();
    expect(container.querySelector('img[data-avatar="photo"]')).toBeNull();
    expect(container.querySelector('svg[data-avatar="portrait"]')).not.toBeNull();
    expect(screen.getByText("AI agent")).toBeTruthy();
  });

  it("a stored role that differs from the name shows beside it with the preference off", () => {
    off(<CallTile participant={{ ...product, name: "Juno", role: "Head of Retail Partnerships" }} />);
    expect(screen.getByTestId("call-name").textContent).toBe("Juno");
    expect(screen.getByTestId("call-role").textContent).toBe("Head of Retail Partnerships");
  });

  it("outside a provider the preference reads as off", () => {
    render(<CallTile participant={cos} />);
    expect(screen.getByTestId("call-name").textContent).toBe("Chief of Staff");
  });
});

describe("CallTile states", () => {
  it("speaking lights the tile and shows the level bars and the word for screen readers", () => {
    const { container } = on(<CallTile participant={product} state="speaking" />);
    const tile = screen.getByTestId("call-tile");
    expect(tile.getAttribute("data-state")).toBe("speaking");
    expect(tile.className).toContain("tone-dept-2");
    expect(container.querySelectorAll(".call-bars > span")).toHaveLength(3);
    expect(screen.getByTestId("call-speaking").textContent).toContain("Speaking");
    expect(tile.getAttribute("aria-label")).toContain("speaking");
  });

  it("idle shows no bars; listening and thinking say so", () => {
    const idle = on(<CallTile participant={product} state="idle" />);
    expect(idle.container.querySelector(".call-bars")).toBeNull();
    idle.unmount();
    on(<CallTile participant={product} state="listening" />);
    expect(screen.getByTestId("call-listening").textContent).toContain("Listening");
    document.body.innerHTML = "";
    on(<CallTile participant={product} state="thinking" />);
    expect(screen.getByTestId("call-thinking").textContent).toContain("Thinking");
  });

  it("the Chief of Staff, outside a department, takes the brand's tone", () => {
    on(<CallTile participant={cos} />);
    expect(screen.getByTestId("call-tile").className).toContain("tone-kit-lift");
  });

  it("the stylesheet stills the bars and the tile's light under prefers-reduced-motion", () => {
    const css = readFileSync(join(__dirname, "../../call.css"), "utf8");
    const bars = css.slice(css.indexOf("@utility call-bars"), css.indexOf("@utility call-stage"));
    expect(bars).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
    const tile = css.slice(css.indexOf("@utility call-tile"), css.indexOf("@utility call-plate"));
    expect(tile).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none/);
  });
});

describe("CallTile: You", () => {
  it("shows the founder's initials, the word You and a live mic level", () => {
    const { container } = render(<CallTile founderName={FOUNDER_NAME} state="speaking" level={0.8} />);
    const tile = screen.getByTestId("call-tile");
    expect(tile.hasAttribute("data-you")).toBe(true);
    expect(tile.textContent).toContain("MO");
    expect(tile.textContent).toContain("You");
    expect(container.querySelector(".call-bars")?.getAttribute("data-level")).toBe("0.80");
    expect(screen.queryByText("AI agent")).toBeNull();
  });

  it("mic off: says so and does not light", () => {
    render(<CallTile founderName={FOUNDER_NAME} state="speaking" micOn={false} level={0.9} />);
    const tile = screen.getByTestId("call-tile");
    expect(tile.textContent).toContain("Mic off");
    expect(tile.getAttribute("data-state")).toBe("idle");
  });
});
