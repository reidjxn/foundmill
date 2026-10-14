import "./setup";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PLAYBOOK_EXAMPLE, PlaybooksPanel } from "../PlaybooksPanel";
import { BID } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";

const flow = {
  trigger: { event: "lead.replied", where: { sentiment: "positive" } },
  steps: [
    { action: { type: "create_task", params: { title: "Draft a reply" } }, label: "Draft a reply" },
    { action: { type: "schedule_meeting", params: {} }, label: "Book a call" },
  ],
  approvals: [{ step: 0, scope: "first_run" }],
  stop: {},
};
const row = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Reply to warm leads",
  sourceText: PLAYBOOK_EXAMPLE,
  enabled: false,
  lastRunAt: null,
  compiled: flow,
  preview: { when: "When a lead replies (sentiment is positive)", steps: [{ text: "Draft a reply", approval: "You approve the first run" }, { text: "Book a call", approval: null }], stop: null },
  ...over,
});

describe("PlaybooksPanel (audit AC-07, #82)", () => {
  it("shows the flow a sentence compiles to, saves it off, and never saves what it could not read", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({
      businessId: BID,
      responses: { "team.playbooks.list": { playbooks: [] } },
      onMutate: (path, input) => {
        if (path === "team.playbooks.compile") return String(input.text).includes("weather") ? { ok: false, question: "Which event should start this rule?" } : { ok: true, playbook: { source_text: input.text, name: "Reply to warm leads", ...flow }, source: "rules" };
        return {};
      },
    });
    renderScreen(fake, <PlaybooksPanel />);
    expect(await screen.findByTestId("playbooks-summary")).toHaveProperty("textContent", "None yet");
    expect((screen.getByTestId("playbook-preview") as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByTestId("playbook-text"), "whenever the weather changes, create a task");
    await user.click(screen.getByTestId("playbook-preview"));
    expect((await screen.findByTestId("playbook-question")).textContent).toBe("Which event should start this rule?");
    expect(screen.queryByTestId("playbook-draft")).toBeNull();

    await user.clear(screen.getByTestId("playbook-text"));
    await user.type(screen.getByTestId("playbook-text"), PLAYBOOK_EXAMPLE);
    await user.click(screen.getByTestId("playbook-preview"));
    const draft = await screen.findByTestId("playbook-draft");
    expect(within(draft).getByTestId("playbook-when").textContent).toBe("When a lead replies (sentiment is positive)");
    expect(within(draft).getAllByTestId("playbook-step").map((s) => s.textContent)).toEqual([expect.stringContaining("Draft a reply"), expect.stringContaining("Book a call")]);

    // The founder drops the second step; the first step's approval stays on the first step.
    await user.click(within(draft).getByRole("button", { name: "Remove step 2" }));
    expect(within(draft).getAllByTestId("playbook-step")).toHaveLength(1);
    await user.click(within(draft).getByTestId("playbook-save"));
    await waitFor(() => expect(fake.mutations.map((m) => m.path)).toContain("team.playbooks.create"));
    const created = fake.mutations.find((m) => m.path === "team.playbooks.create")!.input as { sourceText: string; flow: typeof flow };
    expect(created.sourceText).toBe(PLAYBOOK_EXAMPLE);
    expect(created.flow.steps).toHaveLength(1);
    expect(created.flow.approvals).toEqual([{ step: 0, scope: "first_run" }]);
    expect(created.flow.trigger).toEqual(flow.trigger);
  });

  it("lists saved playbooks as one sentence, turns one on, and cannot turn on one written in the old format", async () => {
    const user = userEvent.setup();
    const legacy = row({ id: "22222222-2222-4222-8222-222222222222", name: "Old rule", compiled: null, preview: null, sourceText: "Every Monday send the digest" });
    const fake = createFakeSource({ businessId: BID, responses: { "team.playbooks.list": { playbooks: [row(), legacy] } }, onMutate: () => ({}) });
    renderScreen(fake, <PlaybooksPanel />);
    const rows = await screen.findAllByTestId("playbook-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(/When a lead replies \(sentiment is positive\), then draft a reply, then book a call \(you approve the first run\)/)).toBeTruthy();
    expect(within(rows[0]!).getByText("Off")).toBeTruthy();
    expect((within(rows[1]!).getByRole("button", { name: "Turn on" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(rows[1]!).getByText(/written in an older format/)).toBeTruthy();

    await user.click(within(rows[0]!).getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "team.playbooks.setEnabled", input: { id: "11111111-1111-4111-8111-111111111111", enabled: true } }));
    await user.click(within(rows[0]!).getByRole("button", { name: "Remove Reply to warm leads" }));
    await waitFor(() => expect(fake.mutations).toContainEqual({ path: "team.playbooks.archive", input: { id: "11111111-1111-4111-8111-111111111111" } }));
  });
});
