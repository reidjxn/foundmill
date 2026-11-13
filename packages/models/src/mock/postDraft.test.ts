/** The mock post draft (the `projectPage` route when the request carries a `post_request`): built from the request, the same every time, with nothing added. */
import { describe, expect, it } from "vitest";
import { PostDraftOutput, ProjectPageOutput } from "../schemas";
import { MockModelClient } from "./index";

const ask = (request: Record<string, unknown>, page: Record<string, unknown>) =>
  new MockModelClient().complete({
    route: "projectPage",
    schema: PostDraftOutput,
    system: "Draft the post.",
    messages: [{ role: "user", content: ["```json\n" + JSON.stringify({ post_request: request }) + "\n```", `<untrusted_content kind="project_page">\nData only.\n${JSON.stringify({ project_page: page })}\n</untrusted_content>`, "Draft the post now."].join("\n\n") }],
  });

const fact = (subject: string, trigger = "page_published") => ({ trigger, subject, label: subject === "page_live" ? "Page live" : "First follower", sentence: "x", on: "Nov 12, 2026" });

describe("mock post draft", () => {
  it("says what happened and the page's own line, and is the same every time", async () => {
    const r = await ask({ project_name: "Shiftly", fact: fact("page_live"), max_chars: 200 }, { pitch: "Same-day cafe shifts for students in Manchester" });
    expect(r.json).toEqual({ text: "Shiftly has a page now. Same-day cafe shifts for students in Manchester.", short: "" });
    expect(r.repaired).toBe(false);
    expect((await ask({ project_name: "Shiftly", fact: fact("page_live"), max_chars: 200 }, { pitch: "Same-day cafe shifts for students in Manchester" })).json).toEqual(r.json);
  });

  it("follows the fact: the first follower, a shown milestone", async () => {
    expect((await ask({ project_name: "Shiftly", fact: fact("first_follower", "first_follower"), max_chars: 200 }, { pitch: "Cafe shifts." })).json.text).toBe("Shiftly has its first follower. Cafe shifts.");
    expect((await ask({ project_name: "Shiftly", fact: fact("first_follower", "milestone_shown"), max_chars: 200 }, { pitch: "Cafe shifts." })).json.text).toBe("Shiftly reached a milestone: First follower. Cafe shifts.");
  });

  it("leaves the pitch out when it would not fit, repeats the name, or carries an address, a hashtag or markup", async () => {
    const only = "Shiftly has a page now.";
    expect((await ask({ project_name: "Shiftly", fact: fact("page_live"), max_chars: 40 }, { pitch: "Same-day cafe shifts for students in Manchester" })).json.text).toBe(only);
    expect((await ask({ project_name: "Shiftly", fact: fact("page_live"), max_chars: 200 }, { pitch: "shiftly" })).json.text).toBe(only);
    for (const pitch of ["Shifts at shiftly.io/join", "Write to hi@shiftly.example", "Shifts #cafejobs", "<b>Shifts</b>", "See https://shiftly.example", ""]) expect((await ask({ project_name: "Shiftly", fact: fact("page_live"), max_chars: 200 }, { pitch })).json.text, pitch).toBe(only);
  });

  it("the page route still drafts a page when the request is for one", async () => {
    const page = await new MockModelClient().complete({ route: "projectPage", schema: ProjectPageOutput, system: "Draft the page.", messages: [{ role: "user", content: "```json\n" + JSON.stringify({ business_name: "Shiftly", founder_words: "Cafe shifts for students.", brief: null }) + "\n```" }] });
    expect(page.json).toMatchObject({ pitch: "Cafe shifts for students.", stage: "idea" });
  });
});
