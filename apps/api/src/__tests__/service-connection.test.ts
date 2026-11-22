/**
 * The service connection in the routers (WP-11 T17, A8-16). User-originated work in a business runs under `ctx.rls`;
 * `ctx.db` bypasses RLS and is allowed for work with no business (`person`), a signed-out caller whose token is the only
 * credential (`signed_out`), a table only services write after the membership check (`service_written`), and the
 * membership read in `businessProcedure`. This counts the lines per router file that name `ctx.db`, so a new use, or a
 * removed one, edits this list in the same pull request and is seen in review. A per-procedure list would need a
 * parser for nested routers; the per-file count catches the same event.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Why = "person" | "signed_out" | "service_written" | "mixed";

export const SERVICE_CONNECTION_ROUTERS: Readonly<Record<string, { lines: number; why: Why; note: string }>> = {
  "live.ts": { lines: 66, why: "person", note: "live social: a person's own posts, follows and messages across projects, Find people and the person page, and the block checks in communities; no business procedure" },
  "idea.ts": { lines: 27, why: "person", note: "ideas before they become a project, owned by the person; idea.commit saves the person's own time and place to their profile (WP-14 T2)" },
  "founder.ts": { lines: 16, why: "mixed", note: "mostly the person's own profile and preferences; two public procedures; a profile save re-rates Founder fit on the person's own ideas (WP-14 T2)" },
  "email.ts": { lines: 15, why: "signed_out", note: "one-click answers and cancel links from an email: the hashed token is the credential" },
  "business.ts": { lines: 16, why: "mixed", note: "creating and listing projects (person), the example project, vacation and the journey refresh, and paid entry's plan check (account_plans crosses accounts)" },
  "agent.ts": { lines: 15, why: "mixed", note: "agent and skill reads and transactions after the procedure's membership check, and paid entry's plan check" },
  "integrations.ts": { lines: 11, why: "mixed", note: "connect and health go through the gateway; credentials are service-only; connect reads the connection it replaces before the gateway rewrites it" },
  "import.ts": { lines: 9, why: "mixed", note: "imports run as protected procedures before and after a project exists" },
  "product.ts": { lines: 5, why: "mixed", note: "not classified line by line" },
  "distribution.ts": { lines: 5, why: "mixed", note: "not classified line by line" },
  "team.ts": { lines: 5, why: "mixed", note: "not classified line by line" },
  "logo.ts": { lines: 5, why: "mixed", note: "generated portraits and logos are written by the service" },
  "idea-box.ts": { lines: 6, why: "mixed", note: "a signed-out visitor's card (service-only tables), the person's own drafts, and the waitlist's next batch (service-only; signed-out readable, four published fields)" },
  "billing.ts": { lines: 12, why: "service_written", note: "checkouts, credit balances, account plans and the Partner waitlist entry (WP-14 T14) are written by the service after the owner check; paid entry's plan check crosses accounts" },
  "legal.ts": { lines: 3, why: "mixed", note: "not classified line by line" },
  "founder-businesses.ts": { lines: 2, why: "person", note: "the person's own list of projects" },
  "dev.ts": { lines: 1, why: "mixed", note: "development and test only" },
  "team-call.ts": { lines: 1, why: "mixed", note: "not classified line by line" },
  "people.ts": { lines: 1, why: "signed_out", note: "public person pages; public procedures only" },
  "report.ts": { lines: 4, why: "person", note: "reports (service-role-only table) filed by a person, the operators' queue, and whether /u/<handle> shows Report" },
};

describe("the service connection in apps/api/src/routers", () => {
  it("each router's ctx.db lines equal the reviewed list", () => {
    const dir = join(__dirname, "..", "routers");
    const counts: Record<string, number> = {};
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const n = readFileSync(join(dir, file), "utf8").split("\n").filter((line) => /\bctx\.db\b/.test(line)).length;
      if (n > 0) counts[file] = n;
    }
    expect(counts).toEqual(Object.fromEntries(Object.entries(SERVICE_CONNECTION_ROUTERS).map(([file, v]) => [file, v.lines])));
  });
});
