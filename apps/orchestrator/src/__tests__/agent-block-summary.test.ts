import { describe, expect, it } from "vitest";
import { agentBlockSummary } from "../activities/session";

const LINES = ["Two suppliers compared", "A sample request sent to the cheapest supplier"];

describe("agentBlockSummary", () => {
  it("quotes each line not counted as met, once", () => {
    const s = agentBlockSummary("Researcher", "Criterion 2 is not met: no email tool is connected", LINES, null);
    expect(s).toBe("Blocked by Researcher: Criterion 2 is not met: no email tool is connected. Not counted as met yet: “Two suppliers compared”; “A sample request sent to the cheapest supplier”.");
  });
  it("leaves out lines marked met and lines the reason already quotes", () => {
    const s = agentBlockSummary("Researcher", `Waiting: “${LINES[1]}” needs mail.`, LINES, [{ line: 1, met: true, reportSection: "Suppliers" }]);
    expect(s).toBe(`Blocked by Researcher: Waiting: “${LINES[1]}” needs mail.`);
  });
  it("is the reason alone without acceptance lines", () => {
    expect(agentBlockSummary("Ops", "no access", [], null)).toBe("Blocked by Ops: no access");
  });
});
