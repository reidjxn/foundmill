/**
 * The wrap-up draft as the live client reads it (founder, Nov 23, 2026: no call had ever finished its wrap-up). The
 * draft reaches the model as prompt JSON (its `params` is an open map), so a reply may leave out a null key or name an
 * unknown type: the client must take it in one call and leave the repair to `finaliseTeamCallWrapUp`.
 */
import { describe, expect, it } from "vitest";
import { LiveModelClient, structuredOutputFor } from "./client";
import { MODELS } from "./routing";
import { TeamCallWrapUpDraft } from "./team-call-schema";

const reply = (text: string) =>
  new Response(JSON.stringify({ id: "msg_t", type: "message", role: "assistant", model: MODELS.opus, content: [{ type: "text", text }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("TeamCallWrapUpDraft on the live client", () => {
  it("is sent as prompt JSON, and a reply without its null keys is taken in one call", async () => {
    expect(structuredOutputFor(TeamCallWrapUpDraft).kind).toBe("prompt");
    // What a live reply looks like: no `detail`, no `action.agent_id`, an unknown type next to a good one.
    const text = JSON.stringify({
      summary: "You agreed the waitlist page.",
      actions: [
        { title: "Build the waitlist page", agent_id: "a1", action: { type: "create_task", params: { kind: "code", title: "Build the waitlist page", goal: "A page with a signup form" } } },
        { title: "Something else", action: { type: "make_coffee" } },
      ],
    });
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      return reply(text);
    }) as unknown as typeof globalThis.fetch;
    const client = new LiveModelClient({ apiKey: "sk-ant-test", fetch, sleep: async () => {} });
    const result = await client.complete({ route: "teamCallWrapUp", system: "s", messages: [{ role: "user", content: "u" }], schema: TeamCallWrapUpDraft });
    expect(calls).toBe(1);
    expect(result.json?.actions).toHaveLength(2);
  });
});
