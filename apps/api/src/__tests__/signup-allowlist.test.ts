/**
 * SIGNUP_ALLOWLIST (audit 2026-10-12 #26): when set, only the addresses and @domains it names reach anything behind
 * sign-in (no profile, no Ideation, no business, no model call); everyone else gets FORBIDDEN with appCode
 * `not_invited` and a sentence to act on. Unset admits everyone; the development bypass user is always admitted.
 */
import { repos } from "@foundmill/db";
import { MockModelClient } from "@foundmill/models";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createCaller } from "../router";
import { allowlisted, NOT_INVITED_MESSAGE, parseSignupAllowlist } from "../services/access";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "allowlist" });
}, 120_000);
afterAll(() => hz.close());

const callerWith = (allowlist: string | undefined, user: { userId: string; email: string | null }, extra: Record<string, unknown> = {}) => createCaller({ ...hz.deps, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: allowlist, ...extra } }, user);

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (err) {
    if (!(err instanceof TRPCError)) throw err;
    const cause = err.cause as { code?: string } | undefined;
    return { code: err.code, appCode: cause?.code, message: err.message };
  }
};

describe("parseSignupAllowlist / allowlisted", () => {
  it("reads addresses and @domains (any case, commas or spaces), and names nobody with a bare word", () => {
    expect(parseSignupAllowlist(undefined)).toBeNull();
    expect(parseSignupAllowlist(" , ")).toBeNull();
    const list = parseSignupAllowlist("Founder@Example.com, @team.example ; other@x.test\n@");
    expect(list && [...list.emails].sort()).toEqual(["founder@example.com", "other@x.test"]);
    expect(list && [...list.domains]).toEqual(["team.example"]);
    expect(allowlisted(list!, "FOUNDER@example.com")).toBe(true);
    expect(allowlisted(list!, "anyone@team.example")).toBe(true);
    // A subdomain or a look-alike is not the listed domain.
    expect(allowlisted(list!, "anyone@sub.team.example")).toBe(false);
    expect(allowlisted(list!, "anyone@evilteam.example")).toBe(false);
    expect(allowlisted(list!, "founder@example.com.evil")).toBe(false);
    expect(allowlisted(list!, null)).toBe(false);
    expect(allowlisted(parseSignupAllowlist("someone")!, "someone@x.test")).toBe(false);
  });
});

describe("protectedProcedure with SIGNUP_ALLOWLIST", () => {
  it("refuses an account the list does not name before any work, with appCode not_invited", async () => {
    const userId = await hz.h.createUser("stranger@elsewhere.test");
    const models = new MockModelClient();
    const stranger = createCaller({ ...hz.deps, models, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: "founder@example.com, @team.example" } }, { userId, email: "stranger@elsewhere.test" });
    expect(await refusal(stranger.founder.profile.get())).toEqual({ code: "FORBIDDEN", appCode: "not_invited", message: NOT_INVITED_MESSAGE });
    // WP-03 T1: what the gate says is true in invite-only and open sign-up alike, and asks nothing of an inviter.
    expect(NOT_INVITED_MESSAGE).toBe("Foundmill is letting new people in a few at a time so every project gets real agent work. Your place is not open yet.");
    expect((await refusal(stranger.idea.generate({ prompt: "x" })))?.appCode).toBe("not_invited");
    expect((await refusal(stranger.founder.preferences.get()))?.code).toBe("FORBIDDEN");
    expect(models.history).toHaveLength(0);
    expect(await repos.founders.get(hz.db, userId)).toBeNull();
  });

  it("admits listed addresses and domains, members of a business included; an account without an email is refused", async () => {
    const list = `owner@allowlist-a.example, @allowlist-domain.example`;
    expect(await refusal(callerWith(list, { userId: hz.A.ownerId, email: "Owner@allowlist-a.example" }).founder.preferences.get())).toBeNull();
    expect(await refusal(callerWith(list, { userId: hz.A.memberId, email: "member@allowlist-domain.example" }).inbox.list({ businessId: hz.A.businessId }))).toBeNull();
    // A member of the business whose address is not listed reaches nothing, the business included.
    expect((await refusal(callerWith(list, { userId: hz.A.viewerId, email: "viewer@elsewhere.test" }).inbox.list({ businessId: hz.A.businessId })))?.appCode).toBe("not_invited");
    expect((await refusal(callerWith(list, { userId: hz.A.adminId, email: null }).founder.preferences.get()))?.appCode).toBe("not_invited");
  });

  it("unset admits everyone; the development bypass user is admitted while it is set", async () => {
    expect(await refusal(callerWith(undefined, { userId: hz.B.ownerId, email: "anyone@anywhere.test" }).founder.preferences.get())).toBeNull();
    expect(await refusal(callerWith("", { userId: hz.B.ownerId, email: "anyone@anywhere.test" }).founder.preferences.get())).toBeNull();
    expect(await refusal(callerWith("founder@example.com", { userId: hz.B.ownerId, email: null }, { DEV_AUTH_USER_ID: hz.B.ownerId }).founder.preferences.get())).toBeNull();
    // Signed out stays UNAUTHORIZED (the list is only about who has signed in).
    expect((await refusal(createCaller({ ...hz.deps, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: "founder@example.com" } }, null).founder.preferences.get()))?.code).toBe("UNAUTHORIZED");
  });

  it("reaches the browser as 403 with appCode not_invited (what the web's invite-only page reads)", async () => {
    const deps = { ...hz.deps, env: { ...hz.deps.env, SIGNUP_ALLOWLIST: "founder@example.com" }, auth: { ...hz.deps.auth, resolve: async () => ({ userId: hz.B.memberId, email: "member@elsewhere.test", authenticatedAt: new Date() }) } } as typeof hz.deps;
    const res = await createApp(deps).request("/trpc/founder.preferences.get", { headers: { authorization: "Bearer x" } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { json: { message: string; data: { code: string; appCode?: string } } } };
    expect(body.error.json).toMatchObject({ message: NOT_INVITED_MESSAGE, data: { code: "FORBIDDEN", appCode: "not_invited" } });
  });
});
