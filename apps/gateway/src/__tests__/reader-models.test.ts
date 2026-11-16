/**
 * The gateway's platform model client fails closed (WP-09 T3, security review): a call that names no business is
 * refused, never run unbooked and ungated.
 */
import type { Db } from "@foundmill/db";
import { describe, expect, it } from "vitest";
import { creditsGate } from "../reader-models";

describe("creditsGate", () => {
  it("refuses a call that names no business before reading anything", async () => {
    const gate = creditsGate({} as Db, true);
    await expect(gate({ route: "quarantinedReader" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(gate({ route: "webSearch", attribution: { kind: "web_search" } as never })).rejects.toMatchObject({ code: "forbidden" });
  });
});
