/**
 * The same outward call runs once per session (WP-05 T14, AR-12): a retried run cannot send, post, spend or ask twice.
 * A repeat of a call that went through answers without calling the vendor; a failed first call may run again; another
 * session runs it; a read-only tool is never deduplicated; a token with no session id is never deduplicated; a different
 * context is a different call; a repeat while the first runs is not run; a stopped team is refused, never replayed.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SAFE_EMAIL, sendHold, sendRefusals, setupGateway, type GatewayFixture } from "./harness";
import type { AllowResponse } from "../types";

let g: GatewayFixture;
beforeAll(async () => {
  g = await setupGateway({ businessMode: "automated" });
}, 120_000);
afterAll(async () => {
  await g.close();
});
beforeEach(() => {
  g.seen.length = 0;
  sendRefusals.length = 0;
});

const send = (token: string, body = "hello") => g.client.call(token, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body } }) as Promise<AllowResponse>;
const sends = () => g.seen.filter((c) => c.tool === "send_message").length;

describe("one outward call per session", () => {
  it("the same send in the same session runs once; the repeat says it already went through", async () => {
    const token = await g.token();
    const first = await send(token, "once");
    expect(first.outcome).toBe("allow");
    expect(first.result.ok).toBe(true);
    const again = await send(token, "once");
    expect(again.outcome).toBe("allow");
    expect(again.result).toMatchObject({ ok: true, data: { replayed: true, note: "This exact call already ran in this session and went through. It was not run again." } });
    expect(again.costMinor).toBe(0);
    // A replayed mock call still says it was simulated.
    expect(again.result).toMatchObject({ simulated: true });
    expect(sends()).toBe(1);
    const audit = await repos.audit.get(g.db, g.businessId, again.auditId);
    expect(audit.details).toMatchObject({ outcome: "replayed" });
  });

  it("a different message in the same session runs", async () => {
    const token = await g.token();
    await send(token, "first message");
    await send(token, "second message");
    expect(sends()).toBe(2);
  });

  it("a failed first call may run again", async () => {
    const token = await g.token();
    sendRefusals.push(400);
    const failed = await send(token, "retry me").catch((e: unknown) => e);
    expect(sends()).toBe(0);
    expect(failed).toBeDefined();
    const second = await send(token, "retry me");
    expect(second.result.ok).toBe(true);
    expect(second.result.data).not.toMatchObject({ replayed: true });
    expect(sends()).toBe(1);
  });

  it("the same call in another session runs", async () => {
    await send(await g.token(), "per session");
    const other = await g.newSession();
    await send(await g.token({ sessionId: other }), "per session");
    expect(sends()).toBe(2);
  });

  it("a token with no session is never deduplicated", async () => {
    const token = await g.token({ sessionId: null });
    await send(token, "no session");
    await send(token, "no session");
    expect(sends()).toBe(2);
  });

  it("the same arguments with a different context are a different call", async () => {
    const token = await g.token();
    const call = (amountMinor: number) => g.client.call(token, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "context" }, context: { amountMinor } });
    await call(0);
    await call(1);
    expect(sends()).toBe(2);
  });

  it("a repeat that arrives while the first is still sending is not sent", async () => {
    const token = await g.token();
    let release!: () => void;
    sendHold.until = new Promise((r) => (release = r));
    sendHold.entered = 0;
    try {
      const first = send(token, "together");
      await expect.poll(() => sendHold.entered).toBe(1);
      const again = await send(token, "together");
      expect(again.result).toMatchObject({ ok: true, data: { replayed: true, stillRunning: true } });
      release();
      expect((await first).result.ok).toBe(true);
    } finally {
      sendHold.until = null;
      release?.();
    }
    expect(sends()).toBe(1);
  });

  it("a stopped team is refused on a repeat too, never answered as a replay", async () => {
    const token = await g.token();
    await send(token, "then stop");
    await repos.agents.pauseAll(g.db, g.businessId);
    try {
      const r = await g.client.call(token, { connector: "test", tool: "send_message", args: { to: SAFE_EMAIL, body: "then stop" } }).catch((e: unknown) => e);
      expect(r).not.toMatchObject({ outcome: "allow" });
    } finally {
      await repos.agents.setStatus(g.db, g.businessId, g.agentId, "healthy");
    }
    expect(sends()).toBe(1);
  });

  it("a read-only tool is never deduplicated", async () => {
    const token = await g.token();
    await g.client.call(token, { connector: "test", tool: "note", args: { text: "same" } });
    await g.client.call(token, { connector: "test", tool: "note", args: { text: "same" } });
    expect(g.seen.filter((c) => c.tool === "note")).toHaveLength(2);
  });
});
