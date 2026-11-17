import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { BasicsList, basicsRows, type BasicsInput } from "../BasicsTab";

const input: BasicsInput = { name: "Northwind", teamCanDo: "Asks before spending over $50", textSize: "comfortable", guidance: "on", credits: { balance: "$3.20", granted: "$5.00" }, people: 1 };

describe("Settings › Basics (WP-10 T11)", () => {
  it("lists five settings, each a link to its tab with its value now", () => {
    render(<BasicsList businessId="b1" rows={basicsRows(input)} />);
    const links = within(screen.getByTestId("settings-basics")).getAllByRole("link");
    expect(links).toHaveLength(5);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/b/b1/settings/business", "/b/b1/settings/mode", "/b/b1/settings/preferences", "/b/b1/settings/billing", "/b/b1/settings/members"]);
    expect(links[0]!.textContent).toContain("Northwind");
    expect(links[1]!.textContent).toContain("Asks before spending over $50");
    expect(links[2]!.textContent).toContain("Comfortable text · explanations on");
    expect(links[3]!.textContent).toContain("$3.20 of $5.00 left this month");
  });

  it("one person reads 'Just you' and holds no call to add someone", () => {
    const people = basicsRows(input).find((r) => r.slug === "members")!;
    expect(people.value).toBe("Just you");
    render(<BasicsList businessId="b1" rows={[people]} />);
    expect(screen.getByRole("link").textContent).not.toMatch(/invite|add|cofounder/i);
    expect(basicsRows({ ...input, people: 3 }).find((r) => r.slug === "members")!.value).toBe("3 people");
  });
});
