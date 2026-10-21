/**
 * The development bearer (docs/DECISIONS.md "Development auth bypass"): in development and test, with
 * DEV_AUTH_USER_ID set, no token or the literal `dev` is the dev user and `dev:<uuid>` is the account it names (the
 * Playwright stack's second account), handed to the dev bootstrap first. In staging and production neither means
 * anything: there is no bypass, so both resolve to nobody and the bootstrap never runs. The bootstrap itself creates
 * the stub auth user once, on PGlite only, and never outside development and test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import type { Db } from "@foundmill/db";
import { createAuthVerifier, parseDevToken } from "../auth";
import { createDevUserBootstrap, devUserBootstrapEnabled, devUserEmail } from "../services/dev-users";

const DEV = "0f0a0d00-0000-4000-8000-00000000f0a1";
const VIEWER = "e2e0e2e0-0000-4000-8000-00000000e5a1";

describe("parseDevToken", () => {
  it("`dev` is the dev user, `dev:<uuid>` that account (lowercased), anything else nothing", () => {
    expect(parseDevToken("dev", DEV)).toBe(DEV);
    expect(parseDevToken(`dev:${VIEWER.toUpperCase()}`, DEV)).toBe(VIEWER);
    expect(parseDevToken("dev:nope", DEV)).toBeNull();
    expect(parseDevToken("devx", DEV)).toBeNull();
    expect(parseDevToken("eyJhbGciOiJIUzI1NiJ9.e30.x", DEV)).toBeNull();
  });
});

describe("createAuthVerifier and dev tokens", () => {
  for (const appEnv of ["development", "test"]) {
    it(`${appEnv}: no token and \`dev\` are the dev user; \`dev:<uuid>\` is that account, bootstrapped first`, async () => {
      const onDevUser = vi.fn(async () => undefined);
      const auth = createAuthVerifier({ appEnv, devUserId: DEV, onDevUser });
      expect((await auth.resolve(null))?.userId).toBe(DEV);
      expect((await auth.resolve("Bearer dev"))?.userId).toBe(DEV);
      expect(onDevUser).not.toHaveBeenCalled();
      const viewer = await auth.resolve(`Bearer dev:${VIEWER}`);
      expect(viewer).toMatchObject({ userId: VIEWER, email: null, emailConfirmed: true });
      expect(onDevUser).toHaveBeenCalledWith(VIEWER);
      // `dev:<the dev user>` is the dev user, with nothing to create.
      onDevUser.mockClear();
      expect((await auth.resolve(`Bearer dev:${DEV}`))?.userId).toBe(DEV);
      expect(onDevUser).not.toHaveBeenCalled();
      // A malformed account id falls back to the dev user, as a stale token does.
      expect((await auth.resolve("Bearer dev:nope"))?.userId).toBe(DEV);
    });
  }

  it("a failed bootstrap is reported and the account still resolves", async () => {
    const onDevUserError = vi.fn();
    const auth = createAuthVerifier({ appEnv: "test", devUserId: DEV, onDevUser: async () => Promise.reject(new Error("db down")), onDevUserError });
    expect((await auth.resolve(`Bearer dev:${VIEWER}`))?.userId).toBe(VIEWER);
    expect(onDevUserError).toHaveBeenCalledWith(expect.any(Error), VIEWER);
  });

  for (const appEnv of ["staging", "production"]) {
    it(`${appEnv}: \`dev\` and \`dev:<uuid>\` resolve to nobody, even with DEV_AUTH_USER_ID set, and nothing is created`, async () => {
      const onDevUser = vi.fn(async () => undefined);
      const auth = createAuthVerifier({ appEnv, devUserId: DEV, onDevUser, hsKey: new TextEncoder().encode("x".repeat(32)) });
      expect(await auth.resolve(null)).toBeNull();
      expect(await auth.resolve("Bearer dev")).toBeNull();
      expect(await auth.resolve(`Bearer dev:${VIEWER}`)).toBeNull();
      expect(await auth.resolve(`Bearer dev:${DEV}`)).toBeNull();
      expect(onDevUser).not.toHaveBeenCalled();
    });
  }

  it("without DEV_AUTH_USER_ID there is no bypass in test either", async () => {
    const auth = createAuthVerifier({ appEnv: "test", hsKey: new TextEncoder().encode("x".repeat(32)) });
    expect(await auth.resolve(`Bearer dev:${VIEWER}`)).toBeNull();
    expect(await auth.resolve("Bearer dev")).toBeNull();
  });
});

describe("the dev account bootstrap", () => {
  it("is on only in development or test, with the dev bypass, on PGlite", () => {
    const base = { APP_ENV: "test", DEV_AUTH_USER_ID: DEV, DATABASE_URL: "pglite:./.pglite/e2e" };
    expect(devUserBootstrapEnabled(base)).toBe(true);
    expect(devUserBootstrapEnabled({ ...base, APP_ENV: "development" })).toBe(true);
    expect(devUserBootstrapEnabled({ ...base, APP_ENV: "staging" })).toBe(false);
    expect(devUserBootstrapEnabled({ ...base, APP_ENV: "production" })).toBe(false);
    expect(devUserBootstrapEnabled({ ...base, DEV_AUTH_USER_ID: undefined })).toBe(false);
    expect(devUserBootstrapEnabled({ ...base, DATABASE_URL: "postgres://localhost:54322/postgres" })).toBe(false);
    expect(devUserBootstrapEnabled({ ...base, DATABASE_URL: null })).toBe(false);
    expect(createDevUserBootstrap({ db: {} as Db, env: { ...base, APP_ENV: "production" } })).toBeUndefined();
  });

  it("ensures each account once, and tries again after a failure", async () => {
    const ensureUser = vi.fn(async (_email: string, o?: { preferredId?: string }) => o?.preferredId ?? "");
    ensureUser.mockRejectedValueOnce(new Error("busy"));
    const boot = createDevUserBootstrap({ db: {} as Db, env: { APP_ENV: "test", DEV_AUTH_USER_ID: DEV, DATABASE_URL: "pglite::memory:" }, auth: { kind: "stub", ensureUser } })!;
    await expect(boot(VIEWER)).rejects.toThrow("busy");
    await boot(VIEWER.toUpperCase());
    await boot(VIEWER);
    expect(ensureUser).toHaveBeenCalledTimes(2);
    expect(ensureUser).toHaveBeenLastCalledWith(devUserEmail(VIEWER), { preferredId: VIEWER, displayName: "Dev account" });
  });

  describe("on PGlite", () => {
    let h: TestHarness;
    beforeAll(async () => {
      h = await createTestDb();
    }, 120_000);
    afterAll(async () => {
      await h?.close();
    });

    it("creates the stub auth user with the account's id and no business", async () => {
      const boot = createDevUserBootstrap({ db: h.db as unknown as Db, env: { APP_ENV: "test", DEV_AUTH_USER_ID: DEV, DATABASE_URL: "pglite::memory:" } })!;
      await boot(VIEWER);
      await boot(VIEWER);
      const users = (await h.db.execute(sql`select id::text as id, email from auth.users where id = ${VIEWER}::uuid`)).rows as { id: string; email: string }[];
      expect(users).toEqual([{ id: VIEWER, email: devUserEmail(VIEWER) }]);
      const memberships = (await h.db.execute(sql`select count(*)::int as n from memberships where user_id = ${VIEWER}::uuid`)).rows as { n: number }[];
      expect(memberships[0]!.n).toBe(0);
    });
  });
});
