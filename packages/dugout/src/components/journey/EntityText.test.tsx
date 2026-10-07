import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntityText, entityIdsIn, entityPlainText, parseEntityText } from "./EntityText";

const ID = "0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c";

describe("parseEntityText", () => {
  it("splits text and mentions and keeps malformed markup as text", () => {
    const segs = parseEntityText(`Scout called [[ent:${ID}|Nordic Beauty AB]] and [[ent:NOTAUUID|Bad]] today`);
    expect(segs).toEqual([
      { type: "text", text: "Scout called " },
      { type: "entity", id: ID, name: "Nordic Beauty AB" },
      { type: "text", text: " and [[ent:NOTAUUID|Bad]] today" },
    ]);
    expect(entityPlainText(`Hi [[ent:${ID}|Sara]]`)).toBe("Hi Sara");
    expect(entityIdsIn(`[[ent:${ID}|A]] [[ent:${ID}|A]]`)).toEqual([ID]);
  });
});

describe("EntityText (journey mentions through the data group's EntityLink)", () => {
  it("renders mentions as entity links with the kind and opens them", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<EntityText text={`Call with [[ent:${ID}|Nordic Beauty AB]]`} kinds={{ [ID]: "organisation" }} onOpenEntity={onOpen} />);
    const link = screen.getByRole("link", { name: "Nordic Beauty AB" });
    expect(link.getAttribute("data-entity-id")).toBe(ID);
    expect(link.getAttribute("data-entity-kind")).toBe("organisation");
    await user.click(link);
    expect(onOpen).toHaveBeenCalledWith(ID);
  });
  it("passes hrefs through and supports a custom renderer", () => {
    const { rerender } = render(<EntityText text={`[[ent:${ID}|Sara]]`} hrefs={{ [ID]: "/crm/sara" }} />);
    expect(screen.getByRole("link", { name: "Sara" }).getAttribute("href")).toBe("/crm/sara");
    rerender(<EntityText text={`[[ent:${ID}|Sara]]`} renderEntity={({ name }) => <mark>{name}!</mark>} />);
    expect(screen.getByText("Sara!").tagName).toBe("MARK");
  });
});
