/**
 * 0137 — one Stripe account, one project: an account signed in with ("Sign in with Stripe") is connected to one project
 * at a time, and ingest's platform endpoint finds that project by the account (`businessForStripeAccount`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("stripeconnect");
});
afterAll(() => r?.close());

const signedIn = (account: string) => ({ connectorKey: "stripe", status: "connected" as const, authKind: "oauth" as const, accountLabel: "Founder Ltd", settings: { externalAccountId: account, config: { kind: "connect" } } });

describe("Stripe accounts signed in with (0137)", () => {
  it("connect one project; a second project is refused until the first disconnects", async () => {
    const A = r.A.businessId;
    const B = r.B.businessId;
    const a = await repos.integrations.upsert(r.db, A, signedIn("acct_1Founder00000001"));
    expect(await repos.integrations.businessForStripeAccount(r.db, "acct_1Founder00000001")).toBe(A);
    expect(await repos.integrations.businessForStripeAccount(r.db, "ACCT_1FOUNDER00000001".replace("ACCT", "acct"))).toBe(A);
    await expect(repos.integrations.upsert(r.db, B, signedIn("acct_1Founder00000001"))).rejects.toThrow();
    // Another account, and the same account through a pasted key, are fine.
    await repos.integrations.upsert(r.db, B, { connectorKey: "stripe", status: "connected", authKind: "oauth", settings: { externalAccountId: "acct_1Founder00000001", config: { kind: "own" } } });
    expect(await repos.integrations.businessForStripeAccount(r.db, "acct_1Founder00000001")).toBe(A);
    // Disconnected, the account is free for another project.
    await repos.integrations.disconnect(r.db, A, a.id);
    expect(await repos.integrations.businessForStripeAccount(r.db, "acct_1Founder00000001")).toBeNull();
    await repos.integrations.upsert(r.db, B, signedIn("acct_1Founder00000001"));
    expect(await repos.integrations.businessForStripeAccount(r.db, "acct_1Founder00000001")).toBe(B);
  });

  it("answers nothing for an unknown or malformed account", async () => {
    expect(await repos.integrations.businessForStripeAccount(r.db, "acct_1Nobody000000009")).toBeNull();
    expect(await repos.integrations.businessForStripeAccount(r.db, "' or 1=1 --")).toBeNull();
  });
});
