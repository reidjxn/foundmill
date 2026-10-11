import "./setup";
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateFormatProvider } from "@foundmill/dugout";
import type { ComponentType } from "react";
import { DAY_FIRST_24H, ISO_24H, usDatesIn } from "../../dates.testing";
import { EnvironmentsScreen } from "../EnvironmentsScreen";
import { PlanScreen } from "../PlanScreen";
import { PullRequestsScreen } from "../PullRequestsScreen";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";
import { agentsResponse, prsResponse, roadmapResponse, tasks, tasksResponse } from "./fixtures";

const props = { businessId: BUSINESS_ID, departmentId: "d-dev" };
const responses = {
  "dev.tasks.list": tasksResponse,
  "product.roadmap.list": roadmapResponse,
  "team.agents.list": agentsResponse,
  "dev.prs.list": prsResponse,
};

function renderAs(
  prefs: typeof ISO_24H,
  Screen: ComponentType<typeof props>,
  extra: Record<string, unknown> = {},
) {
  const fake = createFakeSource({ responses: { ...responses, ...extra } });
  return renderScreen(
    fake,
    <DateFormatProvider value={prefs}>
      <Screen {...props} />
    </DateFormatProvider>,
  );
}

/** The hover titles under `root` that hold a date. */
const dateTitles = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("[title]"))
    .map((el) => el.getAttribute("title") ?? "")
    .filter((t) => /^\d{1,4}[ -]|\b\d{4}$/.test(t));

describe("development dates follow the person's date format", () => {
  it("Plan: a started task's date on hover (the In progress view)", async () => {
    const user = userEvent.setup();
    const { container } = renderAs(DAY_FIRST_24H, PlanScreen);
    await screen.findByRole("grid", { name: "Tasks" });
    await user.click(screen.getByRole("button", { name: /^View: All tasks/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /In progress/ }));
    const titles = dateTitles(screen.getByRole("grid", { name: "Tasks" }));
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t).toMatch(/^\d{1,2} Oct 2026$/);
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Pull requests: the merged date on hover", async () => {
    const { container } = renderAs(ISO_24H, PullRequestsScreen);
    const merged = await screen.findByRole("grid", { name: /merged/i });
    expect(dateTitles(merged)).toContain("2026-10-06");
    expect(usDatesIn(container)).toEqual([]);
  });

  it("Environments: deployment dates on hover", async () => {
    const { container } = renderAs(ISO_24H, EnvironmentsScreen, {
      "dev.tasks.list": { ...tasksResponse, items: tasks.filter((t) => t.kind === "code") },
    });
    await screen.findByRole("grid", { name: "Environments" });
    for (const t of dateTitles(within(container).getByRole("grid", { name: "Environments" })))
      expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(usDatesIn(container)).toEqual([]);
  });
});
