/**
 * What a code session is told about the loop after it (WP-02 T5): with a repository to push to, the platform pushes
 * and opens the pull request; with none, nothing is pushed and the session must never say a pull request opened.
 */
import { describe, expect, it } from "vitest";
import { codeTaskNote } from "../activities/session";

describe("codeTaskNote", () => {
  it("with no repository connected: nothing is pushed and no pull request opens", () => {
    const none = codeTaskNote("agent/t1", "none");
    expect(none).toContain("This project has no repository connected, so nothing is pushed and no pull request opens: never say that it was.");
    expect(none).not.toContain("opens the pull request");
  });

  it("with a repository: the push and the pull request, as before", () => {
    expect(codeTaskNote("agent/t1", "github")).toContain("runs the repository's CI and opens the pull request; the founder decides what goes live.");
    expect(codeTaskNote("agent/t1")).toBe(codeTaskNote("agent/t1", "github"));
  });
});
