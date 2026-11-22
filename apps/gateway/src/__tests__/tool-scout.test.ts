/**
 * The tool scout's platform tools (founder, Nov 22, 2026): any agent says what is missing (`raise_tool_need`, once per
 * project per kind), the scout reads what is known (`read_tool_need`) and sends one recommendation (`recommend_tool`),
 * a note whose terms the platform writes. Nothing here signs up for a vendor, connects one or contacts anyone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecommendToolArgs, TOOL_UNCHECKED_LINE } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { TOOL_PICK_NOTE, toolPickCategory } from "@foundmill/shared";
import { createDbPlatformHost } from "../platform-host";
import { setupGateway, type GatewayFixture } from "./harness";

const SMS = RecommendToolArgs.parse({
  category: "sms",
  pick: { name: "Twilio", route: "link", why: "It texts US and Canadian numbers.", whyNow: "Appointment reminders start this week.", cost: "$0.01 a message" },
  alternatives: [
    { name: "Vonage", line: "Similar price, fewer countries." },
    { name: "Plivo", line: "Cheaper per message, with a monthly number fee." },
  ],
  sources: [{ url: "https://www.twilio.com/en-us/sms/pricing/us", title: "Twilio SMS pricing" }],
});

describe("the tool scout's platform tools", () => {
  let g: GatewayFixture;
  let host: ReturnType<typeof createDbPlatformHost>;
  const caller = () => ({ businessId: g.businessId, agentId: g.agentId, sessionId: null });
  const needTasks = async () => (await repos.tasks.list(g.db, g.businessId, { kind: "tool_need", limit: 100 })).items;

  beforeAll(async () => {
    g = await setupGateway({ businessMode: "augmented" });
    host = createDbPlatformHost({ db: g.db, log: g.deps.log });
  }, 120_000);
  afterAll(async () => g.close());

  it("raise_tool_need puts one task on the board, and a second agent missing the same kind adds none", async () => {
    const first = await host.raiseToolNeed(caller(), { category: "sms", missing: "I could not text the customer a reminder: the project has no way to send text messages." });
    expect(first).toMatchObject({ raised: true, status: "open" });
    const again = await host.raiseToolNeed(caller(), { category: "sms", missing: "No way to text." });
    expect(again.raised).toBe(false);
    expect(again.note).toMatch(/Already raised/);
    expect(await needTasks()).toHaveLength(1);
  });

  it("read_tool_need gives the options Foundmill knows, each price an Estimate, and what is decided", async () => {
    const read = await host.readToolNeed(caller(), { category: "sms" });
    expect(read).toMatchObject({ status: "open", connected: [], pick: null });
    expect(read.options.join("\n")).toMatch(/Twilio: .*Estimate/);
    expect((await host.readToolNeed(caller(), { category: "booking" })).options).toHaveLength(1);
  });

  it("recommend_tool refuses a pick without alternatives, a source and a cost", async () => {
    await expect(host.recommendTool(caller(), { ...SMS, alternatives: [], sources: [] })).rejects.toThrow(/two alternatives.*cite your sources/);
  });

  it("recommend_tool writes one note with the platform's own terms, and remembers the pick", async () => {
    const out = await host.recommendTool(caller(), SMS);
    expect(out).toMatchObject({ subject: "A tool for text messages: Twilio", checkedByFoundmill: true });
    const item = await repos.inbox.get(g.db, g.businessId, out.inboxItemId);
    expect(item.type).toBe("decision");
    expect(item.blocksContinue).toBe(false);
    expect(toolPickCategory(item.decision)).toBe("sms");
    // The catalog's route (the founder's own key), not the agent's "link"; the founder's step is the platform's sentence.
    expect(item.bodyMd).toContain("You sign up with Twilio and accept its terms yourself");
    expect(item.bodyMd).toContain("add your key in Settings › Integrations");
    expect(item.bodyMd).toContain("About $0.01 a message (Estimate).");
    expect((item.decision as { options: { id: string }[] }).options.map((o) => o.id)).toEqual([TOOL_PICK_NOTE.options.yes, TOOL_PICK_NOTE.options.notNow]);
    const need = await repos.toolNeeds.get(g.db, g.businessId, "sms");
    expect(need).toMatchObject({ status: "recommended", inboxItemId: item.id, pick: { name: "Twilio", catalogKey: "twilio", route: "api_key" } });
    expect(need!.alternatives.map((a) => a.name)).toEqual(["Vonage", "Plivo"]);
    expect((await repos.events.list(g.db, g.businessId, { type: "inbox.item_created" })).items.some((e) => (e.payload as { inboxItemId: string }).inboxItemId === item.id)).toBe(true);
  });

  it("does not ask twice: a second recommendation and a later raise both answer with what is decided", async () => {
    await expect(host.recommendTool(caller(), SMS)).rejects.toThrow(/Already recommended to the founder: Twilio/);
    const raise = await host.raiseToolNeed(caller(), { category: "sms", missing: "Still no texts." });
    expect(raise).toMatchObject({ raised: false, status: "recommended" });
  });

  it("after Not now, nothing is raised or recommended until the day to ask again", async () => {
    await repos.toolNeeds.decide(g.db, g.businessId, "sms", "not_now");
    const raise = await host.raiseToolNeed(caller(), { category: "sms", missing: "Still no texts." });
    expect(raise.raised).toBe(false);
    expect(raise.note).toMatch(/The founder said not now, and to ask again after \d{4}-\d{2}-\d{2}/);
    await expect(host.recommendTool(caller(), SMS)).rejects.toThrow(/not now/);
    expect((await host.readToolNeed(caller(), { category: "sms" })).askAgainOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a vendor outside the catalog is marked as not yet checked by Foundmill", async () => {
    const out = await host.recommendTool(caller(), { ...SMS, category: "help_desk", pick: { ...SMS.pick, name: "Crisp", route: "link" } });
    expect(out.checkedByFoundmill).toBe(false);
    expect((await repos.inbox.get(g.db, g.businessId, out.inboxItemId)).bodyMd).toContain(TOOL_UNCHECKED_LINE);
  });
});
