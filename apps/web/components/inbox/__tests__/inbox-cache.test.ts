import { describe, expect, it } from "vitest";
import { markRowRead, patchInboxList, removeRow } from "../inbox-cache";

describe("the Inbox list's optimistic edits (WP-10 T12)", () => {
  const page = { items: [{ id: "a", state: "unread" }, { id: "b", state: "read" }], nextCursor: null };
  it("archive removes the row at once, in the shell's single page and in the list's infinite pages", () => {
    expect(patchInboxList(page, removeRow("a")).items.map((r) => r.id)).toEqual(["b"]);
    const infinite = { pages: [page], pageParams: [null] };
    expect(patchInboxList(infinite, removeRow("a")).pages[0]!.items.map((r) => r.id)).toEqual(["b"]);
  });
  it("mark read turns only that unread row read, and leaves the snapshot to put back untouched", () => {
    const next = patchInboxList(page, markRowRead("a"));
    expect(next.items.map((r) => r.state)).toEqual(["read", "read"]);
    expect(page.items[0]!.state).toBe("unread");
  });
  it("leaves data of another shape alone", () => {
    expect(patchInboxList(undefined, removeRow("a"))).toBeUndefined();
  });
});
