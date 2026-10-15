// @vitest-environment node
/**
 * lib/widget-data.tsx `isAccountRead` against the API's own router: a read is account-level exactly when its input has
 * no `businessId` at all, neither as a business procedure (`BusinessInput`) nor as an optional scope of its own (saved
 * table views): the widget source sends those without one. A new read in a router that changes sides fails here until
 * the list in lib/widget-data.tsx says where it belongs.
 */
import { appRouter } from "@foundmill/api/router";
import { BusinessInput } from "@foundmill/api/trpc";
import { describe, expect, it } from "vitest";
import { isAccountRead } from "../widget-data";

interface ProcedureDef {
  type: "query" | "mutation" | "subscription";
  inputs: unknown[];
}

const procedures = Object.entries((appRouter as unknown as { _def: { procedures: Record<string, { _def: ProcedureDef }> } })._def.procedures).map(([path, p]) => ({ path, def: p._def }));
const reads = procedures.filter((p) => p.def.type === "query");

/** The keys of a zod object input (through `.optional()`, `.nullable()`, `.default()` and pipes), or none. */
function inputKeys(input: unknown): string[] {
  let schema = input as { shape?: Record<string, unknown>; _zod?: { def?: { innerType?: unknown; in?: unknown } } } | null;
  for (let depth = 0; schema && !schema.shape && depth < 8; depth += 1) schema = (schema._zod?.def?.innerType ?? schema._zod?.def?.in ?? null) as typeof schema;
  return schema?.shape && typeof schema.shape === "object" ? Object.keys(schema.shape) : [];
}

/** True when the read's input names a business: a business procedure, or an optional `businessId` of its own. */
const takesBusiness = (def: ProcedureDef) => def.inputs.includes(BusinessInput) || def.inputs.some((i) => inputKeys(i).includes("businessId"));

describe("account reads", () => {
  it("are exactly the reads whose input names no business", () => {
    expect(reads.length).toBeGreaterThan(50);
    const wrong = reads.filter(({ path, def }) => isAccountRead(path) === takesBusiness(def)).map((p) => p.path);
    expect(wrong).toEqual([]);
  });

  it("cover the reads the shell and the widgets share", () => {
    expect(isAccountRead("founder.profile.get")).toBe(true);
    expect(reads.some((p) => p.path === "founder.profile.get" && !takesBusiness(p.def))).toBe(true);
  });
});
