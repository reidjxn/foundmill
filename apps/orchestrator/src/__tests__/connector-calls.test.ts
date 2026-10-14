/**
 * The orchestrator's own connector calls (plan actions, Door B imports) use real tool names and argument shapes: each
 * one built here runs against that connector's mock, which validates the arguments exactly as the gateway's connector
 * does. A plan's send_message used to call `sendgrid.send_email` (no such tool) with `{ to, body }`, and every import
 * of a Drive source called `google_drive.search`; neither could ever run.
 */
import { describe, expect, it } from "vitest";
import { githubMock, gmailMock, googleCalendarMock, googleDriveMock, opencorporatesMock, sendgridMock, stripeMock, type Connector } from "@foundmill/connectors";
import { makeToolContext } from "@foundmill/connectors/testing/contract-suite";
import { createEventArgs, emailsIn, firstSlotIn, freeSlotArgs, gmailSendArgs, importCallFor, meetingFor, messageFor, resultData, resultError, sendgridSendArgs, verifiedSenderIn } from "../activities/connector-calls";

const business = { name: "Northwind Skincare" };
const NOW = new Date("2026-10-05T09:00:00.000Z");
const run = (c: Connector, tool: string, args: unknown) => c.callTool(tool, args, makeToolContext(c));
const allow = (r: Awaited<ReturnType<Connector["callTool"]>>) => ({ outcome: "allow", result: r });
/** The call was accepted as written: whatever the vendor answered, it was not refused for its name or arguments. */
const accepted = async (c: Connector, tool: string, args: unknown) => {
  const r = await run(c, tool, args);
  expect(["unknown_tool", "invalid_args"], `${c.key}.${tool}: ${JSON.stringify(r.error)}`).not.toContain(r.error?.code);
  return r;
};

describe("plan action connector calls", () => {
  it("reads only addresses out of plan params", () => {
    expect(emailsIn("Maja")).toEqual([]);
    expect(emailsIn("Maja <Maja@SensitiveSkinClub.se>", ["cfo@example.com", "not an address"], undefined)).toEqual(["maja@sensitiveskinclub.se", "cfo@example.com"]);
    expect(emailsIn("a@example.com; b@example.com")).toEqual(["a@example.com", "b@example.com"]);
  });

  it("send_message becomes gmail.send_message (or sendgrid.send_mail) with the disclosure, and fails early without an address", async () => {
    const message = messageFor({ recipient: "maja@sensitiveskinclub.se", intent: "Ask Maja for a call next week", requires_disclosure: true }, business);
    if ("error" in message) throw new Error(message.error);
    expect(message).toMatchObject({ connector: "gmail", to: ["maja@sensitiveskinclub.se"], subject: "Ask Maja for a call next week" });
    expect(message.text).toBe("Ask Maja for a call next week\n\nSent on behalf of Northwind Skincare by its AI assistant.");
    const sent = await accepted(gmailMock, "send_message", gmailSendArgs(message));
    expect(sent.ok).toBe(true);

    const viaSendgrid = messageFor({ connector: "sendgrid", to: ["anna.lind@example.com"], subject: "Your order", body: "It ships today." }, business);
    if ("error" in viaSendgrid) throw new Error(viaSendgrid.error);
    const from = verifiedSenderIn(resultData(allow(await accepted(sendgridMock, "list_verified_senders", {}))));
    expect(from).toBeTruthy();
    expect((await accepted(sendgridMock, "send_mail", sendgridSendArgs(viaSendgrid, from!))).ok).toBe(true);

    expect(messageFor({ recipient: "Maja", intent: "Say hello" }, business)).toEqual({ error: expect.stringContaining("needs an email address for Maja") });
    expect(messageFor({ to: "a@example.com" }, business)).toEqual({ error: expect.stringContaining("what to say") });
  });

  it("schedule_meeting finds a free slot when no time is named, then creates the event with real arguments", async () => {
    const meeting = meetingFor({ with: "maja@sensitiveskinclub.se", topic: "Partnership intro" }, NOW);
    if ("error" in meeting) throw new Error(meeting.error);
    expect(meeting.start).toBeUndefined();
    const free = allow(await accepted(googleCalendarMock, "find_free_slots", freeSlotArgs(meeting)));
    const slot = firstSlotIn(resultData(free));
    expect(slot).not.toBeNull();
    const created = await accepted(googleCalendarMock, "create_event", createEventArgs(meeting, slot!));
    expect(created.data).toMatchObject({ summary: "Partnership intro", attendees: [{ email: "maja@sensitiveskinclub.se" }] });

    const timed = meetingFor({ attendees: ["x@example.com"], title: "Intro", start: "2026-10-08T13:00:00Z" }, NOW);
    if ("error" in timed) throw new Error(timed.error);
    expect(timed).toMatchObject({ start: "2026-10-08T13:00:00.000Z", end: "2026-10-08T13:30:00.000Z" });
    await accepted(googleCalendarMock, "create_event", createEventArgs(timed, { start: timed.start!, end: timed.end! }));
    expect(meetingFor({ with: "the supplier" }, NOW)).toEqual({ error: expect.stringContaining("needs an email address for the supplier") });
  });

  it("reports a vendor failure inside an allowed call", () => {
    expect(resultError({ outcome: "allow", result: { ok: false, error: { code: "recipient_suppressed", message: "x is suppressed" } } })).toBe("x is suppressed");
    expect(resultError({ outcome: "allow", result: { ok: true, data: {} } })).toBeNull();
    expect(resultError({ outcome: "ask" })).toBeNull();
  });
});

describe("Door B import calls", () => {
  it("maps each source address to a real read with valid arguments", async () => {
    const cases: [string, string, Connector][] = [
      ["https://github.com/northwind/storefront", "Storefront", githubMock],
      ["https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit", "Pitch", googleDriveMock],
      ["https://drive.google.com/drive/folders/xyz", "Brand guide", googleDriveMock],
      ["https://dashboard.stripe.com/acct_123", "Stripe", stripeMock],
      ["https://find-and-update.company-information.service.gov.uk/company/123 companieshouse", "Northwind Skincare Ltd", opencorporatesMock],
    ];
    for (const [uri, title, connector] of cases) {
      const call = importCallFor(uri, title);
      expect(call?.connector, uri).toBe(connector.key);
      await accepted(connector, call!.tool, call!.args);
    }
    expect(importCallFor("https://github.com/northwind/storefront.git", "")).toMatchObject({ tool: "read_tree", args: { owner: "northwind", repo: "storefront" } });
    expect(importCallFor("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUv/edit", "")).toMatchObject({ tool: "read_doc", args: { documentId: "1AbCdEfGhIjKlMnOpQrStUv" } });
    expect(importCallFor("https://example.com", "x")).toBeNull();
  });
});
