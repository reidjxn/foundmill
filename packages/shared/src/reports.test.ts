import { describe, expect, it } from "vitest";
import { parseOperatorIds, reportDueAt, REPORT_RESPONSE_TARGET_HOURS } from "./reports";

describe("parseOperatorIds (OPERATOR_USER_IDS)", () => {
  it("unset, empty or malformed means nobody is an operator", () => {
    for (const raw of [undefined, null, "", " ", ",", "not-an-id", "*", "all", "true", "reid@foundmill.com", "63d2dcc8-83a4-4ac7-bc72"]) expect(parseOperatorIds(raw).size).toBe(0);
  });
  it("keeps only account ids, lower-cased, ignoring spaces and stray values", () => {
    expect([...parseOperatorIds(" 63D2DCC8-83A4-4AC7-BC72-B323A1F8B1E4 , junk,")]).toEqual(["63d2dcc8-83a4-4ac7-bc72-b323a1f8b1e4"]);
  });
  it("the response target is two days", () => {
    expect(REPORT_RESPONSE_TARGET_HOURS).toBe(48);
    expect(reportDueAt(new Date("2026-11-17T08:00:00Z")).toISOString()).toBe("2026-11-19T08:00:00.000Z");
  });
});
