/**
 * Team › Agents with Builder view off (docs/DESIGN.md "Builder view"): no Form, Rating, Tools or Model columns, no
 * Health, Tools or Performance views, and Simple reads Agent, Status, Current task, Latest update.
 */
import "./setup";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GuidanceProvider } from "@foundmill/dugout";
import { termsWithGlossary } from "@foundmill/shared/terms";
import { FOUNDER_SIMPLE_COLUMNS, SIMPLE_VIEW_ID, SquadScreen, TEAM_SQUAD_VIEWS, teamSquadViews } from "../SquadScreen";
import { BID, DEPT_TEAM, dataResponses } from "./fixtures";
import { createFakeSource, renderScreen } from "./fake-source";

const props = { businessId: BID, departmentId: DEPT_TEAM };
const headersOf = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((h) => h.textContent?.replace(/Resize.*$/, "").trim()).filter((h) => h !== "Actions");

describe("SquadScreen with Builder view off", () => {
  it("teamSquadViews: Simple becomes Agent, Status, Current task, Latest update; on is unchanged", () => {
    expect(teamSquadViews(true)).toBe(TEAM_SQUAD_VIEWS);
    expect(teamSquadViews(false).find((v) => v.id === SIMPLE_VIEW_ID)).toMatchObject({ columns: FOUNDER_SIMPLE_COLUMNS, sort: [] });
  });

  it("opens Simple (guidance on) without the rating, and General (guidance off) without Form, Rating or Model", async () => {
    const { unmount } = renderScreen(createFakeSource({ businessId: BID, responses: dataResponses }), <GuidanceProvider value={{ terms: termsWithGlossary(null) }}><SquadScreen {...props} /></GuidanceProvider>, {}, { builder: false });
    const simple = await screen.findByRole("treegrid", { name: "Agents" });
    expect(headersOf(simple)).toEqual(["Agent", "Status", "Current task", "Latest update"]);
    expect(document.body.textContent).not.toMatch(/Rating \/20/);
    unmount();

    renderScreen(createFakeSource({ businessId: BID, responses: dataResponses }), <GuidanceProvider value={{ guidance: "off" }}><SquadScreen {...props} /></GuidanceProvider>, {}, { builder: false });
    const general = await screen.findByRole("treegrid", { name: "Agents" });
    const heads = headersOf(general);
    for (const h of ["Form", "Rating /20", "Model", "Tools"]) expect(heads).not.toContain(h);
    expect(heads).toContain("AI cost (USD)");
    // Health, Tools and Performance are Builder view's views.
    fireEvent.pointerDown(screen.getByRole("button", { name: /^View: / }), { button: 0, ctrlKey: false });
    const menu = await screen.findByRole("menu");
    const names = within(menu).getAllByRole("menuitemradio").map((i) => i.textContent?.trim());
    expect(names.some((n) => /Health|Performance/.test(n ?? ""))).toBe(false);
    expect(names.some((n) => /General/.test(n ?? ""))).toBe(true);
  });
});
