import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CallStage, callStageColumns } from "./CallStage";
import { AGENT_IDS, ONE_TO_ONE_AGENT, TEAM_CALL_AGENTS } from "./fixtures";

const tiles = () => screen.getAllByTestId("call-tile");
const stateOf = (id: string) => document.querySelector(`[data-agent-id="${id}"]`)!.getAttribute("data-state");

describe("CallStage", () => {
  it("columns for 1 to 9 tiles", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(callStageColumns)).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 3]);
  });

  it("a team call: five agents and You, one speaking, the rest listening", () => {
    render(<CallStage kind="team" participants={TEAM_CALL_AGENTS} speakingAgentId={AGENT_IDS.growth} />);
    expect(tiles()).toHaveLength(6);
    expect(screen.getByTestId("call-stage").getAttribute("data-layout")).toBe("team");
    expect(stateOf(AGENT_IDS.growth)).toBe("speaking");
    expect(stateOf(AGENT_IDS.cos)).toBe("listening");
    expect(document.querySelectorAll('[data-state="speaking"]')).toHaveLength(1);
  });

  it("nobody speaking: everyone idle; a thinking agent says so", () => {
    render(<CallStage kind="team" participants={TEAM_CALL_AGENTS} thinkingAgentIds={[AGENT_IDS.finance]} />);
    expect(stateOf(AGENT_IDS.cos)).toBe("idle");
    expect(stateOf(AGENT_IDS.finance)).toBe("thinking");
  });

  it("tiles keep their place and identity while speakers change", () => {
    const { rerender } = render(<CallStage kind="team" participants={TEAM_CALL_AGENTS} speakingAgentId={AGENT_IDS.cos} />);
    const before = tiles();
    rerender(<CallStage kind="team" participants={TEAM_CALL_AGENTS} speakingAgentId={AGENT_IDS.support} />);
    const after = tiles();
    expect(after).toHaveLength(before.length);
    after.forEach((el, i) => expect(el).toBe(before[i]));
    expect(stateOf(AGENT_IDS.support)).toBe("speaking");
    expect(stateOf(AGENT_IDS.cos)).toBe("listening");
  });

  it("the founder speaking lights You and leaves the agents listening", () => {
    render(<CallStage kind="team" participants={TEAM_CALL_AGENTS} founderSpeaking micLevel={0.7} />);
    expect(document.querySelector("[data-you]")!.getAttribute("data-state")).toBe("speaking");
    expect(stateOf(AGENT_IDS.cos)).toBe("listening");
  });

  it("one-to-one: the agent large and You small", () => {
    render(<CallStage kind="one_to_one" participants={[ONE_TO_ONE_AGENT]} />);
    expect(tiles()).toHaveLength(2);
    const stage = screen.getByTestId("call-stage");
    expect(stage.getAttribute("data-layout")).toBe("one_to_one");
    expect(stage.querySelector("[data-call-you] [data-you]")!.getAttribute("data-size")).toBe("small");
    expect(stage.querySelector(`[data-agent-id="${ONE_TO_ONE_AGENT.agentId}"]`)!.getAttribute("data-size")).toBe("default");
  });

  it("never shows more than eight agents and You", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...TEAM_CALL_AGENTS[0]!, agentId: `a-${i}` }));
    render(<CallStage kind="team" participants={many} />);
    expect(tiles()).toHaveLength(9);
  });
});
