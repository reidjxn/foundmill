import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "dept-shortcut" });
}, 120_000);
afterAll(() => hz.close());

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "OK";
  } catch (err) {
    return err instanceof TRPCError ? err.code : `other:${String(err)}`;
  }
};

describe("department shortcuts (audit AC-13)", () => {
  it("every department carries a stored letter; renaming one moves only its own; the founder can choose one", async () => {
    const bid = hz.A.businessId;
    const owner = hz.caller({ userId: hz.A.ownerId });
    const ops = await owner.department.create({ businessId: bid, name: "Operations", moduleKeys: ["development"] });
    const fin = await owner.department.create({ businessId: bid, name: "Finance", moduleKeys: ["finance"] });
    const before = await owner.department.list({ businessId: bid, includeHidden: true });
    const letterOf = (rows: typeof before, id: string) => rows.find((d) => d.id === id)?.shortcut;
    expect(before.every((d) => typeof d.shortcut === "string" && /^[A-Z]$/.test(d.shortcut))).toBe(true);
    const finBefore = letterOf(before, fin.id);
    await owner.department.update({ businessId: bid, departmentId: ops.id, patch: { name: "Supply Chain" } });
    const after = await owner.department.list({ businessId: bid, includeHidden: true });
    expect(letterOf(after, fin.id)).toBe(finBefore);
    for (const d of before) if (d.id !== ops.id) expect(letterOf(after, d.id), d.name).toBe(d.shortcut);

    const chosen = await owner.department.setShortcut({ businessId: bid, departmentId: fin.id, letter: "q" });
    expect([chosen.shortcut, chosen.shortcutChosen]).toEqual(["Q", true]);
    expect(await code(owner.department.setShortcut({ businessId: bid, departmentId: fin.id, letter: "G" }))).toBe("BAD_REQUEST");
  });

  it("is an admin's change: a member is refused, and another business's department is not found", async () => {
    const member = hz.caller({ userId: hz.A.memberId });
    expect(await code(member.department.setShortcut({ businessId: hz.A.businessId, departmentId: hz.A.departmentId, letter: "Z" }))).toBe("FORBIDDEN");
    const owner = hz.caller({ userId: hz.A.ownerId });
    expect(await code(owner.department.setShortcut({ businessId: hz.A.businessId, departmentId: hz.B.departmentId, letter: "Z" }))).toBe("NOT_FOUND");
  });
});
