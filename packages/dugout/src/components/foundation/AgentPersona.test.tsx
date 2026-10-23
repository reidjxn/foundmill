import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AGENT_PERSONA_OFF, AgentPersonaProvider, createAgentPersonaApi, useAgentPersona } from "./AgentPersona";

const cos = { name: "Chief of Staff", role: "Chief of Staff", personaKey: "malik" };
const plain = { name: "Support Agent", role: "Support", personaKey: null };

describe("createAgentPersonaApi", () => {
  it("off: today's names, no faces", () => {
    const api = createAgentPersonaApi({ anthropomorphic: false, portraitUrl: () => "/x" });
    expect(api).toBe(AGENT_PERSONA_OFF);
    expect(api.nameFor(cos)).toBe("Chief of Staff");
    expect(api.labelFor(cos)).toBe("Chief of Staff");
    expect(api.portraitFor(cos)).toBeUndefined();
    expect(api.hasPersona(cos)).toBe(false);
  });

  it("on: the first name, the label with the position, and the face by key", () => {
    const api = createAgentPersonaApi({ anthropomorphic: true, portraitUrl: (k) => (k === "malik" ? "/personas/malik" : null) });
    expect(api.nameFor(cos)).toBe("Malik");
    expect(api.labelFor(cos)).toBe("Malik (Chief of Staff)");
    expect(api.positionFor(cos)).toBe("Chief of Staff");
    expect(api.portraitFor(cos)).toBe("/personas/malik");
    expect(api.hasPersona(cos)).toBe(true);
  });

  it("on: an agent without a persona (or with an unknown key) keeps its own name and drawn portrait", () => {
    const api = createAgentPersonaApi({ anthropomorphic: true, portraitUrl: () => "/x" });
    expect(api.nameFor(plain)).toBe("Support Agent");
    expect(api.labelFor(plain)).toBe("Support Agent");
    expect(api.portraitFor(plain)).toBeUndefined();
    expect(api.labelFor({ ...plain, personaKey: "not-a-key" })).toBe("Support Agent");
    expect(api.portraitFor({ personaKey: "not-a-key" })).toBeUndefined();
  });

  it("on: a portrait that is not ready yet gives no URL", () => {
    const api = createAgentPersonaApi({ anthropomorphic: true, portraitUrl: () => null });
    expect(api.portraitFor(cos)).toBeUndefined();
    expect(api.nameFor(cos)).toBe("Malik");
  });

  it("labels with the agent's own name as the position when it has no role", () => {
    const api = createAgentPersonaApi({ anthropomorphic: true });
    expect(api.labelFor({ name: "Head of Growth", personaKey: "amara" })).toBe("Amara (Head of Growth)");
  });
});

describe("AgentPersonaProvider", () => {
  function Probe() {
    const p = useAgentPersona();
    return <p>{p.labelFor(cos)}</p>;
  }
  it("is off outside a provider", () => {
    render(<Probe />);
    expect(screen.getByText("Chief of Staff")).toBeTruthy();
  });
  it("provides the display rules below it", () => {
    render(
      <AgentPersonaProvider anthropomorphic>
        <Probe />
      </AgentPersonaProvider>,
    );
    expect(screen.getByText("Malik (Chief of Staff)")).toBeTruthy();
  });
});
