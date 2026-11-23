/**
 * The founder's own Gmail and Google Calendar at the gateway (founder, Nov 19, 2026): inviting people from the
 * founder's calendar asks in every mode, and the founder answers it even when Team › Responsibilities names an agent or
 * a person for messages to customers. The same holds for mail from the founder's Gmail. Events with nobody invited run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { googleCalendarMock } from "@foundmill/connectors";
import { FOUNDER_ACCOUNT_SEND_TOOLS, repos } from "@foundmill/db";
import { setupGateway, type GatewayFixture } from "./harness";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway({ connectors: [googleCalendarMock] });
}, 120_000);
afterAll(async () => {
  await g.close();
});

const invite = { summary: "Demo", start: "2026-10-08T13:00:00Z", end: "2026-10-08T13:30:00Z", attendees: ["sara@ledgerly.app"] };

describe("the founder's own calendar and mail at the gateway", () => {
  // Outside contact runs from the first message (founder, Nov 23, 2026): an invitation runs in automated mode, and
  // where a mode still asks (augmented), only the founder answers.
  it("an invitation runs in automated mode; in augmented mode it asks, and a delegate for messages to customers does not decide it", async () => {
    await repos.businesses.setBusinessMode(g.db, g.businessId, "automated");
    const dept = await repos.departments.create(g.db, g.businessId, { name: "Ops" });
    const chief = await repos.agents.create(g.db, g.businessId, { name: "Chief", agentType: "chief_of_staff", departmentIds: [dept.id] });
    await repos.agents.update(g.db, g.businessId, g.agentId, { departmentIds: [dept.id] });
    await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [{ decisionType: "message_customers", handler: { kind: "agent", id: chief.id } }] });
    try {
      const token = await g.token({ allowedTools: ["google_calendar:create_event"] });
      expect((await g.client.call(token, { connector: "google_calendar", tool: "create_event", args: invite })).outcome).toBe("allow");
      await repos.businesses.setBusinessMode(g.db, g.businessId, "augmented");
      const r = await g.client.call(token, { connector: "google_calendar", tool: "create_event", args: { ...invite, summary: "Demo 2" } });
      expect(r.outcome).toBe("ask");
      const approval = await repos.approvals.get(g.db, g.businessId, (r as { approvalId: string }).approvalId);
      expect(approval.byKind ?? null).toBeNull();
      expect(approval.handlerKind ?? null).toBeNull();
      // Mail from the founder's Gmail is routed the same way (the approval row, as the gateway opens it).
      const mail = await repos.approvals.create(g.db, g.businessId, { agentId: g.agentId, connectorKey: "gmail", tool: "send_message", args: { to: ["a@example.com"] }, decisionType: "message_customers" });
      expect(mail.byKind ?? null).toBeNull();
      expect(mail.handlerKind ?? null).toBeNull();
      expect([...FOUNDER_ACCOUNT_SEND_TOOLS].sort()).toEqual(["gmail:send_message", "google_calendar:create_event", "google_calendar:delete_event", "google_calendar:update_event"]);
    } finally {
      await repos.businesses.setBusinessMode(g.db, g.businessId, "automated");
      await repos.departments.update(g.db, g.businessId, dept.id, { approvers: [] });
    }
  });

  it("an event with nobody invited runs, on the founder's primary calendar only", async () => {
    const token = await g.token({ allowedTools: ["google_calendar:add_event"] });
    const r = await g.client.call(token, { connector: "google_calendar", tool: "add_event", args: { summary: "Prep", start: "2026-10-08T12:00:00Z", end: "2026-10-08T12:30:00Z" } });
    expect(r.outcome).toBe("allow");
    const shared = await g.client.call(token, { connector: "google_calendar", tool: "add_event", args: { calendarId: "team@group.calendar.google.com", summary: "Prep", start: "2026-10-08T12:00:00Z", end: "2026-10-08T12:30:00Z" } });
    expect(JSON.stringify(shared)).toMatch(/invalid_args|primary/);
  });
});
