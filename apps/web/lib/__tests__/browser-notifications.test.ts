import { describe, expect, it } from "vitest";
import { winNoticeFor } from "../browser-notifications";

const biz = { id: "b1", name: "Tutorlane" };

describe("winNoticeFor", () => {
  it("notices a paying customer and a reached goal, nothing else", () => {
    expect(winNoticeFor({ type: "customer.converted", payload: { kind: "payment", conversionId: "c1" } }, biz)).toMatchObject({ title: "Tutorlane won a customer", href: "/b/b1/inbox", tag: "win:c1" });
    expect(winNoticeFor({ type: "goal.achieved", payload: { goalId: "g1" } }, biz)).toMatchObject({ title: "Tutorlane reached its goal", tag: "goal:g1" });
    expect(winNoticeFor({ type: "customer.converted", payload: { kind: "signup" } }, biz)).toBeNull();
    expect(winNoticeFor({ type: "cycle.completed", payload: {} }, biz)).toBeNull();
  });
});
