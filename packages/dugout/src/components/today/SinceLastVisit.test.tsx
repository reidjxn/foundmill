import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SinceLastVisit } from "./SinceLastVisit";

afterEach(cleanup);

describe("SinceLastVisit", () => {
  it("lists what happened with its links, and renders nothing when nothing did", () => {
    const { rerender } = render(<SinceLastVisit meta="Since Nov 10" lines={[{ id: "work", text: "3 rounds of work, 7 tasks done." }, { id: "decisions", text: "2 new decisions need you.", link: { href: "/b/x/inbox", label: "Answer" } }]} />);
    expect(screen.getByText("Since you were last here")).toBeTruthy();
    expect(screen.getByText("3 rounds of work, 7 tasks done.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Answer/ }).getAttribute("href")).toBe("/b/x/inbox");
    rerender(<SinceLastVisit meta="Since Nov 10" lines={[]} />);
    expect(screen.queryByTestId("since-last-visit")).toBeNull();
  });
});
