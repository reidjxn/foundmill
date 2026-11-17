/**
 * founder.email.sendLink (WP-03 T3): the link to a desktop-only page, emailed to the signed-in person from a small
 * screen. Signed out is UNAUTHORIZED; a path outside `isContinuePath` is BAD_REQUEST and never reaches the gateway; the
 * gateway is asked with the caller's own id, never one from input; a simulated send is not reported as sent.
 */
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GatewayAccountEmailRequest, GatewayNotifyEmailResult } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
const asked: GatewayAccountEmailRequest[] = [];
let answer: () => Promise<GatewayNotifyEmailResult> = async () => ({ sent: true, simulated: false, eventId: null });

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "founder-continue-link" });
  hz.deps.gateway.accountEmail = async (input) => (asked.push(input), answer());
}, 120_000);
afterAll(() => hz.close());
beforeEach(() => {
  asked.length = 0;
  answer = async () => ({ sent: true, simulated: false, eventId: null });
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

describe("founder.email.sendLink", () => {
  const path = () => `/b/${hz.A.businessId}/product/page`;

  it("signed out is UNAUTHORIZED; a bad path is BAD_REQUEST; neither asks the gateway", async () => {
    expect(await code(hz.caller(null).founder.email.sendLink({ path: "/home" }))).toBe("UNAUTHORIZED");
    const me = hz.caller({ userId: hz.A.ownerId, email: "owner@example.com" });
    for (const bad of ["//evil.example", "/login", "/auth/callback", "/b/x?next=", `/b/${hz.A.businessId}/${"a".repeat(200)}`]) expect(await code(me.founder.email.sendLink({ path: bad })), bad).toBe("BAD_REQUEST");
    expect(await code((me.founder.email.sendLink as (i: unknown) => Promise<unknown>)({ path: "/home", userId: hz.B.ownerId }))).toBe("BAD_REQUEST");
    expect(asked).toHaveLength(0);
  });

  it("asks the gateway once, with the caller's own id and the path, and says where it went", async () => {
    const me = hz.caller({ userId: hz.A.ownerId, email: "owner@example.com" });
    expect(await me.founder.email.sendLink({ path: path() })).toEqual({ sent: true, reason: null, email: "owner@example.com" });
    expect(asked).toEqual([{ kind: "continue_link", userId: hz.A.ownerId, data: { path: path() } }]);
  });

  it("never reports a simulated send, a refusal or a silent gateway as sent", async () => {
    const me = hz.caller({ userId: hz.A.ownerId, email: "owner@example.com" });
    answer = async () => ({ sent: true, simulated: true, eventId: null });
    expect(await me.founder.email.sendLink({ path: "/onboarding" })).toEqual({ sent: false, reason: "simulated", email: null });
    answer = async () => ({ sent: false, reason: "off", message: "x" });
    expect(await me.founder.email.sendLink({ path: "/onboarding" })).toEqual({ sent: false, reason: "off", email: null });
    answer = async () => {
      throw new Error("down");
    };
    expect(await me.founder.email.sendLink({ path: "/onboarding" })).toEqual({ sent: false, reason: "vendor", email: null });
    const without = hz.deps.gateway.accountEmail;
    hz.deps.gateway.accountEmail = undefined;
    try {
      expect(await me.founder.email.sendLink({ path: "/home" })).toEqual({ sent: false, reason: "off", email: null });
    } finally {
      hz.deps.gateway.accountEmail = without;
    }
  });
});
