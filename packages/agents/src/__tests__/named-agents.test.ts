/**
 * WP-14 T6 (the brief's A9): whatever name a founder's screen gives an agent, the agent itself knows it is an AI agent
 * and writes outward for the business. The fixed house rules say so in every agent's system prompt, ahead of anything
 * a template or an instructions draft adds, and a prompt is built without any character name: there is no input for
 * one. The gateway's `named-agents-outward.test.ts` holds the other half (nothing outward can read a character's name).
 */
import { APP_NAME } from "@foundmill/config";
import { describe, expect, it } from "vitest";
import { CLUB_RULES, buildSystemPrompt, listTemplates } from "../index";

describe("an agent never writes as though it were a person", () => {
  const templates = listTemplates();

  it("every template's system prompt opens with the rule, for the business it works for", () => {
    expect(templates.length).toBeGreaterThan(20);
    for (const template of templates) {
      const prompt = buildSystemPrompt({ businessName: "Maple Bakes", appName: APP_NAME, template });
      expect(prompt, template.key).toContain(`You are an AI agent working for Maple Bakes inside ${APP_NAME}.`);
      expect(prompt, template.key).toContain("Never claim to be human. Outbound messages are sent on behalf of Maple Bakes.");
      // The rules come first: nothing a template writes can sit above them.
      expect(prompt.indexOf("Never claim to be human."), template.key).toBeLessThan(prompt.indexOf(template.instructions.role));
    }
  });

  it("the rule is house rule 3 and is not one a template can drop", () => {
    expect(CLUB_RULES.find((r) => r.slug === "never_human")).toMatchObject({ id: 3, text: "Never claim to be human. Outbound messages are sent on behalf of {business_name}." });
  });
});
