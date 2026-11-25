// @vitest-environment happy-dom
/**
 * The site's ready note shows the "Before it goes live" list it was written with, and only shows it (founder, Nov 25,
 * 2026: "it should never be a blocker, it should just show the user"): no button of its own, whatever the items say.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { siteLaunchChecklist } from "@foundmill/shared/launch-checklist";
import { SITE_READY_NOTE } from "@foundmill/shared/sites";
import { SiteLaunchList } from "../SiteLaunchList";

const decision = (launch_checklist: unknown) => ({ key: SITE_READY_NOTE.key, options: [{ id: "site_publish" }, { id: "site_later" }], launch_checklist });

describe("SiteLaunchList", () => {
  it("shows every item Not yet with no control of its own, so the note's Publish it is untouched", () => {
    const items = siteLaunchChecklist([{ path: "index.html", text: "<html><body><h1>Hi</h1></body></html>" }]);
    expect(items.every((i) => !i.ready)).toBe(true);
    render(<SiteLaunchList decision={decision(items)} />);
    const list = screen.getByRole("region", { name: "Before it goes live" });
    expect(within(list).getAllByRole("img", { name: "Not yet" })).toHaveLength(items.length);
    expect(within(list).queryByRole("button")).toBeNull();
    expect(within(list).getByText(/You can publish now either way/)).toBeTruthy();
  });

  it("shows nothing for another note, for a note without a list, or for a list it cannot read", () => {
    const { container } = render(
      <>
        <SiteLaunchList decision={{ key: "other", launch_checklist: [] }} />
        <SiteLaunchList decision={decision(undefined)} />
        <SiteLaunchList decision={decision([{ id: "people" }])} />
      </>,
    );
    expect(container.textContent).toBe("");
  });
});
