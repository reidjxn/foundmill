/**
 * A named agent never writes to a third party as though it were a person (WP-14 T6; the brief's A9).
 *
 * "Named agents" (the `anthropomorphicAgents` preference) is a display choice of each reader: the first name and face
 * are picked when a screen is drawn, from the agent's `persona_key` and the reader's own preference
 * (@foundmill/shared `agentDisplay`). This guard holds the two things that keep such a name inside the product:
 *
 *   1. Nothing that acts outward can read a character's name. The code that sends, posts, publishes or drafts for a
 *      third party (this gateway, the connectors, the agents' prompts and templates, the orchestrator, the composer,
 *      the sandbox) does not use the display rules. The exceptions are listed with the reason each is not outward.
 *   2. The project's own mail goes out under the project's name: the sender is "<Project> via <APP_NAME>", set by the
 *      gateway, and the tool an agent calls has no field for a sender at all.
 *
 * House rule 3 ("Never claim to be human. Outbound messages are sent on behalf of <business>.") is in every agent's
 * system prompt; packages/agents `named-agents.test.ts` holds that part.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME } from "@foundmill/config";
import { PlatformSendMail, platformMailSenderName } from "@foundmill/connectors";
import { PERSONAS } from "@foundmill/shared";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Everything that can act outward, or writes what an agent reads before it does. */
const OUTWARD_ROOTS = ["apps/gateway/src", "apps/orchestrator/src", "apps/composer/src", "packages/connectors/src", "packages/agents/src", "packages/sandbox/src"];

/** The display rules of @foundmill/shared/personas, and the catalogs they read. */
const DISPLAY_RULES = /\b(agentDisplay|agentLabel|agentDisplayName|agentCharacter|characterFor|personaByKey|withAgentNames|PERSONAS|STYLE_CATALOGS)\b/;

/** The files under those roots that may name a character, each with why it is not a message to a third party. */
const NOT_OUTWARD: Record<string, string> = {
  "apps/gateway/src/portraits.ts": "draws a character's picture from the catalog; it sends nothing and signs nothing",
  "apps/gateway/src/notify-email.ts": "mail from the product to the founder themself, under their own preference, as \"Name (Position)\"",
  "packages/agents/src/prompts/team-call.ts": "the founder's own call with their team; stored text still carries the stored name",
};

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "__tests__" || entry === "fixtures" || entry === "node_modules") continue;
      out.push(...sources(path));
    } else if (/\.tsx?$/.test(entry) && !/\.(test|stories)\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe("a named agent never writes to a third party as though it were a person", () => {
  it("nothing that acts outward reads a character's name, apart from the listed files that are not outward", () => {
    const users: string[] = [];
    let scanned = 0;
    for (const root of OUTWARD_ROOTS) {
      for (const file of sources(join(ROOT, root))) {
        scanned += 1;
        if (DISPLAY_RULES.test(readFileSync(file, "utf8"))) users.push(relative(ROOT, file).split(sep).join("/"));
      }
    }
    // The scan read real code: every root is there and holds source.
    expect(scanned).toBeGreaterThan(200);
    expect(users.sort()).toEqual(Object.keys(NOT_OUTWARD).sort());
  });

  it("the one exception that sends mail names an agent with its position, never by a first name alone", () => {
    const mail = readFileSync(join(ROOT, "apps/gateway/src/notify-email.ts"), "utf8");
    expect(mail).toMatch(/\bagentLabel\(/);
    expect(mail).not.toMatch(/\bagentDisplayName\(|agentDisplay\([^)]*"name"\)/);
  });

  it("the project's mail goes out under the project's name, and an agent cannot choose the sender", () => {
    expect(platformMailSenderName("Maple Bakes", "maple-bakes").fromName).toBe(`Maple Bakes via ${APP_NAME}`);
    const mail = { to: { email: "customer@example.com" }, subject: "Your order", text: "It shipped today." };
    expect(PlatformSendMail.safeParse(mail).success).toBe(true);
    // No field for a sender: a character's name cannot be put on the message.
    for (const extra of [{ from: { name: PERSONAS[0]!.name } }, { fromName: PERSONAS[0]!.name }, { sender: PERSONAS[0]!.name }, { replyTo: "malik@example.com" }]) expect(PlatformSendMail.safeParse({ ...mail, ...extra }).success, Object.keys(extra)[0]).toBe(false);
  });
});
