/**
 * Skills load on demand (WP-06 T4), offline: for a task one of ten indexed skills covers, the request offers
 * `read_skill`, carries that skill's index line and the sentence that says to read it, and none of the bodies. The
 * Skills section is the same for every case (it stays in the cached prefix). Live behavior: read-skill.eval.test.ts.
 */
import { describe, expect, it } from "vitest";
import { SKILLS_HEADER } from "@foundmill/agents";
import { READ_SKILL_CASES, READ_SKILL_KEYS, SEND_NOW_LINE, checkReadSkillRequest, checkSendNowPlan, readSkillRequest, sendNowRequest } from "../skills/read-skill";

describe("skills.read (offline)", () => {
  it("has ten cases, one per indexed skill", () => {
    expect(READ_SKILL_CASES).toHaveLength(10);
    expect(new Set(READ_SKILL_CASES.map((c) => c.expected))).toEqual(new Set(READ_SKILL_KEYS));
  });

  for (const c of READ_SKILL_CASES) {
    it(`${c.id}: offers read_skill and carries the index, no bodies`, () => {
      expect(checkReadSkillRequest(c)).toEqual([]);
    });
  }

  it("the prompt up to the end of the Skills section is the same for every task", () => {
    const prefixes = new Set(READ_SKILL_CASES.map((c) => readSkillRequest(c, 1).system).map((s) => s.slice(0, s.indexOf("\n\n## ", s.indexOf(SKILLS_HEADER) + 1))));
    expect(prefixes.size).toBe(1);
  });

  it("the send-now case loads the skill line, and the check refuses a plan that sends or stays silent", () => {
    const { system } = sendNowRequest();
    expect(system).toContain(SEND_NOW_LINE);
    expect(checkSendNowPlan({ actions: [{ tool: "platform_mail.send_mail", args: {}, reason: "The skill says send it now." }], escalations: [], notes: "" })).not.toEqual([]);
    expect(checkSendNowPlan({ actions: [], escalations: ["Approve the first email to Harbor Goods"], notes: "" })).toEqual(["did not say the skill's line was not followed"]);
    expect(checkSendNowPlan({ actions: [{ tool: "platform.request_human_action", args: {}, reason: "Needs approval" }], escalations: [], notes: "I did not follow the skill's line to send it as soon as it is ready: this email needs your approval." })).toEqual([]);
  });
});
