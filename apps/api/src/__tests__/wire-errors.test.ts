/**
 * What goes over the wire (security review): request ids are plain tokens or replaced; an INTERNAL error reads as a generic
 * line with the request id outside development and test, whether a procedure or the context factory raised it, and carries
 * no stack; a foreign-key violation is "not found" when a write names a missing row and a conflict when a delete is blocked.
 */
import { TRPCError } from "@trpc/server";
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app";
import { requestIdFrom } from "../request-id";
import { foreignKeyViolation, internalErrorMessage, toTRPCError } from "../trpc";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "wire", env: { APP_ENV: "staging" } });
}, 120_000);
afterAll(() => hz.close());

const RAW = 'Failed query: select count(*) from "messages" where user = $1\nparams: s3cret-value';
const signedIn = () => ({ ...hz.deps, auth: { ...hz.deps.auth, resolve: async () => ({ userId: hz.A.ownerId, email: null, authenticatedAt: new Date() }) } }) as typeof hz.deps;
const call = (deps: typeof hz.deps, headers: Record<string, string> = {}) => createApp(deps).request("/trpc/live.messages.unread", { headers: { authorization: "Bearer x", ...headers } });
const errorOf = async (res: Response) => ((await res.json()) as { error: { json: { message: string; data: { code: string; stack?: string } } } }).error.json;

describe("request ids", () => {
  it("keeps a plain token and replaces anything else, in the response header and in what errors quote", async () => {
    const ok = await call(signedIn(), { "x-request-id": "req-12345678" });
    expect(ok.headers.get("x-request-id")).toBe("req-12345678");
    for (const bad of ["short", "has spaces in it!", "<script>alert(1)</script>", "a".repeat(65), "ünïcode-request-id", "semi;colon-12345"]) {
      const res = await call(signedIn(), { "x-request-id": bad });
      const id = res.headers.get("x-request-id")!;
      expect(id, bad).not.toBe(bad);
      expect(id, bad).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect((await call(signedIn())).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is a pure rule: 8 to 64 letters, digits and hyphens", () => {
    expect(requestIdFrom("abcd-1234")).toBe("abcd-1234");
    expect(requestIdFrom("a".repeat(64))).toBe("a".repeat(64));
    for (const bad of [undefined, null, "", "short", "a".repeat(65), "with space", "under_score-1234", "new\nline-1234"]) expect(requestIdFrom(bad as string | null | undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("INTERNAL errors outside development and test", () => {
  it("a procedure's database error reaches the client as a generic line with the request id, no stack, never the SQL", async () => {
    const spy = vi.spyOn(repos.social, "unreadCount").mockRejectedValueOnce(new Error(RAW));
    try {
      const res = await call(signedIn(), { "x-request-id": "req-abcdef12" });
      expect(res.status).toBe(500);
      const err = await errorOf(res);
      expect(err.data.code).toBe("INTERNAL_SERVER_ERROR");
      expect(err.message).toContain("req-abcdef12");
      expect(err.message).not.toMatch(/Failed query|messages|s3cret|select/);
      expect(err.data.stack ?? null).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("so does an error raised before any procedure runs (the context factory)", async () => {
    // No context exists yet, so the formatter reads the environment from the process, and fails closed when it is not dev or test.
    const deps = { ...hz.deps, auth: { ...hz.deps.auth, resolve: async () => Promise.reject(new Error(RAW)) } } as typeof hz.deps;
    vi.stubEnv("APP_ENV", "staging");
    try {
      const res = await call(deps);
      expect(res.status).toBe(500);
      const err = await errorOf(res);
      expect(err.message).toBe("Something went wrong on our side.");
      expect(JSON.stringify(err)).not.toMatch(/Failed query|s3cret|select count|params:/);
      expect(err.data.stack ?? null).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
    // In development and test it stays readable.
    vi.stubEnv("APP_ENV", "test");
    try {
      expect((await errorOf(await call(deps))).message).toBe(RAW);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("other errors keep their own message, and development and test keep the raw one", async () => {
    const res = await createApp(hz.deps).request("/trpc/live.messages.unread", { headers: { authorization: "Bearer x" } });
    expect((await errorOf(res)).data.code).toBe("UNAUTHORIZED");
    expect(internalErrorMessage(RAW, "development", "r")).toBe(RAW);
    expect(internalErrorMessage(RAW, "test")).toBe(RAW);
    expect(internalErrorMessage(RAW, "production")).toBe("Something went wrong on our side.");
    expect(internalErrorMessage(RAW, "staging", "req-1")).toContain("req-1");
  });
});

describe("foreign-key violations", () => {
  const pg = (message: string, constraint?: string) => new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed query: …", cause: Object.assign(new Error("Failed query: …"), { cause: Object.assign(new Error(message), { code: "23503", constraint }) }) });

  it("a write that names a missing row is not found; a delete or update that other rows still point at is a conflict", () => {
    const missing = toTRPCError(pg('insert or update on table "connections" violates foreign key constraint "connections_to_user_fkey"', "connections_to_user_fkey"));
    expect(missing.code).toBe("NOT_FOUND");
    expect(missing.message).not.toMatch(/connections|constraint/);
    const inUse = toTRPCError(pg('update or delete on table "posts" violates foreign key constraint "posts_parent_post_id_fkey" on table "posts"'));
    expect(inUse.code).toBe("CONFLICT");
    expect(inUse.message).not.toMatch(/posts|constraint/);
    // A code we set on purpose is left alone, and a database error that is not a foreign key stays INTERNAL.
    expect(toTRPCError(new TRPCError({ code: "FORBIDDEN", message: "No", cause: Object.assign(new Error("x"), { code: "23503" }) })).code).toBe("FORBIDDEN");
    expect(toTRPCError(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "x", cause: Object.assign(new Error("dup"), { code: "23505" }) })).code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("names the kind and the constraint for the log", () => {
    expect(foreignKeyViolation(pg('insert or update on table "posts" violates foreign key constraint "posts_community_id_fkey"').cause)).toEqual({ kind: "reference", constraint: "posts_community_id_fkey" });
    expect(foreignKeyViolation(pg('update or delete on table "communities" violates foreign key constraint "posts_community_id_fkey" on table "posts"', "posts_community_id_fkey").cause)).toEqual({ kind: "in_use", constraint: "posts_community_id_fkey" });
    expect(foreignKeyViolation(new Error("plain"))).toBeUndefined();
  });
});
