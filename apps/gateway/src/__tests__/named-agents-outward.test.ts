/**
 * A named agent never writes to a third party as though it were a person (WP-14 T6; the brief's A9): the part this
 * gateway holds. The project's own mail goes out under the project's name: the sender is "<Project> via <APP_NAME>",
 * set here, and the tool an agent calls has no field for a sender at all, so a character's name cannot be put on a
 * message. The other parts: apps/web `lib/__tests__/named-agents-outward.test.ts` (nothing that acts outward can read
 * a character's name) and packages/agents `named-agents.test.ts` (house rule 3 in every agent's system prompt).
 */
import { APP_NAME } from "@foundmill/config";
import { PlatformSendMail, platformMailSenderName } from "@foundmill/connectors";
import { PERSONAS } from "@foundmill/shared";
import { describe, expect, it } from "vitest";

describe("a named agent never writes to a third party as though it were a person", () => {
  it("the project's mail goes out under the project's name, and an agent cannot choose the sender", () => {
    expect(platformMailSenderName("Maple Bakes", "maple-bakes").fromName).toBe(`Maple Bakes via ${APP_NAME}`);
    const mail = { to: { email: "customer@example.com" }, subject: "Your order", text: "It shipped today." };
    expect(PlatformSendMail.safeParse(mail).success).toBe(true);
    // No field for a sender: a character's name cannot be put on the message.
    for (const extra of [{ from: { name: PERSONAS[0]!.name } }, { fromName: PERSONAS[0]!.name }, { sender: PERSONAS[0]!.name }, { replyTo: "malik@example.com" }]) expect(PlatformSendMail.safeParse({ ...mail, ...extra }).success, Object.keys(extra)[0]).toBe(false);
  });
});
