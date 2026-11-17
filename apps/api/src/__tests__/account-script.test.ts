/** The operator's account script (WP-11 T16): export prints one account's JSON; check refuses while they solely own a project. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAccountCommand } from "../scripts/account";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "account-script" });
}, 120_000);
afterAll(() => hz.close());

const run = async (command: string, userId: string) => {
  const lines: string[] = [];
  const code = await runAccountCommand(hz.db, command, userId, (l) => void lines.push(l));
  return { code, lines };
};

describe("account script", () => {
  it("export prints the person's own data", async () => {
    const r = await run("export", hz.A.ownerId);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.lines[0]!) as { userId: string; tables: Record<string, unknown[]> };
    expect(out.userId).toBe(hz.A.ownerId);
    expect(r.lines[0]).not.toContain(hz.B.businessId);
  });

  it("check exits 1 while the person is a project's only owner, and verify refuses while the account still exists", async () => {
    expect((await run("check", hz.A.ownerId)).code).toBe(1);
    expect((await run("verify", hz.A.ownerId)).code).toBe(1);
    expect((await run("nonsense", hz.A.ownerId)).code).toBe(2);
  });
});
