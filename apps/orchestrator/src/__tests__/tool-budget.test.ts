/**
 * WP-09 T7 step 2: the tool definitions a session's agent is given are part of every request it makes, so the tokens of
 * a template's granted tools may not grow past a ceiling set at today's largest template plus 10% (Estimate: a tool's
 * name, description and input schema as JSON at `estimateTokens`). A new tool or a longer description that pushes a
 * template over fails here: shorten it, or move it to a skill, before raising the ceiling.
 */
import { describe, expect, it } from "vitest";
import { ALL_TEMPLATES } from "@foundmill/agents";
import { createAllConnectors, createBuiltinConnectors, resolveGrants } from "@foundmill/connectors";
import { estimateTokens } from "@foundmill/models";

const connectors = new Map([...createAllConnectors({ secrets: {} }), ...createBuiltinConnectors({ secrets: {} })].map((c) => [c.key, c]));

/** The Estimate of the tokens of the tool definitions a template's grants put in front of the model. */
function toolSchemaTokens(grants: Parameters<typeof resolveGrants>[0]): number {
  let total = 0;
  for (const ref of resolveGrants(grants).toolRefs) {
    const [key, name] = ref.split(":") as [string, string];
    for (const tool of connectors.get(key)?.tools ?? []) if (name === "*" || tool.name === name) total += estimateTokens(JSON.stringify({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
  }
  return total;
}

/** Today's largest template (channel_geo, 5,758) plus 10%, rounded up to 500 (Estimate). */
const CEILING = 6_500;

describe("tool definitions stay inside a token ceiling", () => {
  // Utility templates (classifier, triage, moderation) hold no tools. If the registry came back empty the ceiling would pass for nothing.
  it("measures the registry: the largest template is within 10% of the ceiling's basis", () => {
    const largest = Math.max(...ALL_TEMPLATES.map((t) => toolSchemaTokens(t.tools)));
    expect(largest).toBeGreaterThan(CEILING / 1.2);
  });

  it.each(ALL_TEMPLATES.map((t) => [t.key, t] as const))("%s", (_key, template) => {
    const tokens = toolSchemaTokens(template.tools);
    expect(tokens, `${template.key}'s tool definitions grew past ${CEILING} tokens (Estimate): shorten them or move the detail to a skill`).toBeLessThanOrEqual(CEILING);
  });
});
