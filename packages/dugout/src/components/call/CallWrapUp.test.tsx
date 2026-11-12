import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { teamCallActionsLine } from "@foundmill/shared/team-call";
import { AgentPersonaProvider } from "../foundation/AgentPersona";
import { CallWrapUp, actionTarget, groupCallActions } from "./CallWrapUp";
import { DEPARTMENT_NAMES, TEAM_CALL_ACTIONS, TEAM_CALL_AGENTS, TEAM_CALL_SUMMARY, portraitDataUrl } from "./fixtures";

const name = (id: string) => DEPARTMENT_NAMES[id] ?? "?";

describe("groupCallActions", () => {
  it("groups by department in first-seen order, with the department's name from the caller", () => {
    const groups = groupCallActions(TEAM_CALL_ACTIONS, name);
    expect(groups.map((g) => g.name)).toEqual(["Product", "Customers", "Finance", "Support"]);
    expect(groups[0]!.actions).toHaveLength(2);
  });

  it("business-wide actions come last, under a neutral heading", () => {
    const groups = groupCallActions([{ ...TEAM_CALL_ACTIONS[0]!, departmentId: null }, ...TEAM_CALL_ACTIONS.slice(2, 3)], name);
    expect(groups.map((g) => g.name)).toEqual(["Customers", "Across the project"]);
  });

  it("a target is the action's own, else the plan it waits in", () => {
    expect(actionTarget({ target: { kind: "task", id: "t" }, planId: "p" })).toEqual({ kind: "task", id: "t" });
    expect(actionTarget({ target: null, planId: "p" })).toEqual({ kind: "plan", id: "p" });
    expect(actionTarget({ target: null, planId: null })).toBeNull();
  });
});

describe("CallWrapUp", () => {
  const view = (onOpenTarget = vi.fn()) => {
    render(
      <AgentPersonaProvider anthropomorphic style="humans" portraitUrl={portraitDataUrl}>
        <CallWrapUp summary={TEAM_CALL_SUMMARY} actions={TEAM_CALL_ACTIONS} participants={TEAM_CALL_AGENTS} departmentName={name} onOpenTarget={onOpenTarget} />
      </AgentPersonaProvider>,
    );
    return onOpenTarget;
  };

  it("shows the summary and the actions line from the shared helper", () => {
    view();
    expect(screen.getByTestId("call-summary").textContent).toBe(TEAM_CALL_SUMMARY);
    expect(screen.getByTestId("call-actions-line").textContent).toBe(teamCallActionsLine(TEAM_CALL_ACTIONS));
    expect(screen.getByTestId("call-actions-line").textContent).toBe("3 filed · 2 need your go-ahead · 1 yours to do · 1 not filed");
  });

  it("groups actions under their department names", () => {
    view();
    const groups = screen.getAllByTestId("call-action-group");
    expect(groups.map((g) => within(g).getByTestId("call-group-name").textContent)).toEqual(["Product", "Customers", "Finance", "Support"]);
    expect(within(groups[1]!).getAllByTestId("call-action")).toHaveLength(2);
  });

  it("each action carries a status chip in the founder's words", () => {
    view();
    const chips = screen.getAllByTestId("call-action-status").map((c) => c.textContent);
    expect(chips).toEqual(["Filed", "Filed", "Filed", "Needs your go-ahead", "Needs your go-ahead", "Yours to do", "Not filed"]);
    expect(screen.getByText("Support is not open to changes from calls yet.")).toBeTruthy();
  });

  it("links through onOpenTarget with the target and the action", async () => {
    const onOpen = view();
    await userEvent.setup().click(screen.getByRole("button", { name: "Open roadmap item: Open the waitlist on the roadmap" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "roadmap_item", id: "road-1" }, expect.objectContaining({ id: "act-2" }));
    await userEvent.setup().click(screen.getAllByRole("button", { name: /Open plan to confirm/ })[0]!);
    expect(onOpen).toHaveBeenLastCalledWith({ kind: "plan", id: "plan-1" }, expect.objectContaining({ status: "awaiting_go_ahead" }));
    // A founder step and an unfiled action have nowhere to go.
    expect(screen.queryByRole("button", { name: /Sign the domain/ })).toBeNull();
  });

  it("names who does an action under the persona rules", () => {
    view();
    expect(screen.getAllByText("Priya (Product Lead)").length).toBeGreaterThan(0);
  });

  it("nothing to file says so", () => {
    render(<CallWrapUp summary="We talked." actions={[]} departmentName={name} />);
    expect(screen.getAllByText("Nothing to file from this call.").length).toBeGreaterThan(0);
  });
});
