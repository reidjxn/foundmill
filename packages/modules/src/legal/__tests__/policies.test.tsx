import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { PoliciesScreen } from "../PoliciesScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, BLOCK, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d-legal" };

describe("PoliciesScreen", () => {
  it("diffs the generated privacy policy against the published block and applies accepted hunks as a human edit", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <PoliciesScreen {...props} />);
    const panel = screen.getByRole("region", { name: "Policies" });
    expect(within(panel).getByRole("tab", { name: "Privacy policy" }).getAttribute("aria-selected")).toBe("true");
    expect(within(panel).getByText(/change(s)? proposed/)).toBeTruthy();
    expect(within(panel).getByText(/1 hunk/)).toBeTruthy();
    expect(within(panel).getByText(/1 pending/)).toBeTruthy();
    const apply = within(panel).getByRole("button", { name: "Apply accepted hunks" });
    expect(apply.hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Accept all" }));
    expect(apply.hasAttribute("disabled")).toBe(false);
    fireEvent.click(apply);
    await waitFor(() => expect(fake.mutations).toHaveLength(1));
    const m = fake.mutations[0]!;
    expect(m.path).toBe("product.spec.editBlock");
    expect(m.input.blockId).toBe(BLOCK.privacy);
    const patch = m.input.patch as { content: { type: string; content: { type: string; content?: { text?: string }[] }[] }; pinned: boolean };
    expect(patch.pinned).toBe(true);
    expect(patch.content.type).toBe("doc");
    const text = JSON.stringify(patch.content);
    expect(text).toContain("Twilio SendGrid");
    expect(text).toContain("Last updated October 7, 2026");
    expect(text).not.toContain("We use Stripe only.");
    await screen.findByText("Applied");
    expect(fake.refetches["product.spec.get"]).toBe(1);
    expect(fake.queried.get("product.spec.get")).toEqual({ section: "Policies" });
  });

  it("publishes the first version of a policy that is not in the spec yet, as the founder (#174)", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({ id: "new-block" }) });
    renderScreen(fake, <PoliciesScreen {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "Cookie policy" }));
    const preview = screen.getByRole("region", { name: "Cookie policy preview" });
    expect(within(preview).getByText(/Publishing adds it to the "Policies" section of the product spec as you/)).toBeTruthy();
    expect(within(preview).queryByText(/Product lead publishes/)).toBeNull();
    fireEvent.click(within(preview).getByRole("button", { name: "Publish to the spec" }));
    await waitFor(() => expect(fake.mutations).toHaveLength(1));
    const m = fake.mutations[0]!;
    expect(m.path).toBe("legal.policies.publish");
    expect(m.input.title).toBe("Cookie policy");
    const doc = m.input.content as { type: string; content: { type: string; attrs?: { level: number }; content?: { text?: string }[] }[] };
    expect(doc.type).toBe("doc");
    expect(doc.content[0]).toMatchObject({ type: "heading", content: [{ text: "Cookie policy" }] });
    expect(JSON.stringify(doc)).toContain("__stripe_mid");
    await waitFor(() => expect(fake.refetches["product.spec.get"]).toBe(1));
  });

  it("offers no publish for a policy that is already in the spec, and shows a publish failure", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => { throw new Error("The cookie policy is already in the spec; refresh it instead"); } });
    renderScreen(fake, <PoliciesScreen {...props} />);
    expect(screen.queryByRole("button", { name: "Publish to the spec" })).toBeNull(); // the privacy policy is published
    fireEvent.click(screen.getByRole("tab", { name: "Cookie policy" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish to the spec" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The cookie policy is already in the spec; refresh it instead");
  });

  it("previews a policy that is not in the spec yet, lists the data map and the policy proposals", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <PoliciesScreen {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "Cookie policy" }));
    const preview = screen.getByRole("region", { name: "Cookie policy preview" });
    expect(within(preview).getByText("Not yet in the spec")).toBeTruthy();
    expect(within(preview).getByRole("heading", { level: 1 }).textContent).toBe("Cookie policy");
    expect(within(preview).getByText("__stripe_mid")).toBeTruthy();
    const map = screen.getByRole("table", { name: "Data flows" });
    expect(within(map).getAllByRole("row")).toHaveLength(5);
    expect(within(map).getByText("Mystery Tool")).toBeTruthy();
    expect(within(map).queryByText("Shopify")).toBeNull();
    const proposals = screen.getByRole("list", { name: "Policy proposals" });
    expect(within(proposals).getByText("Update the privacy policy for SendGrid")).toBeTruthy();
    expect(within(proposals).queryByText("Roadmap wording")).toBeNull();
    fireEvent.click(within(proposals).getByRole("button", { name: "Decide" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/d/product/changes?proposal=p1`);
    expect(screen.getAllByText("Information, not legal or tax advice").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Terms of service" }));
    expect(screen.getByText("Pinned (human-edited)")).toBeTruthy();
  });

  it("shows empty states and errors", () => {
    const fake = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(fake, <PoliciesScreen {...props} />);
    expect(screen.getByText(/Connect integrations in Settings/)).toBeTruthy();
    expect(screen.getByText(/the Source Watcher raises a change proposal/)).toBeTruthy();
    expect(screen.getByText("Not yet in the spec")).toBeTruthy();
    expect(screen.getByText(/We do not share personal data with third-party processors/)).toBeTruthy();
    act(() => fake.setResponse("business.get", new Error("business unavailable")));
    expect(screen.getByText("business unavailable")).toBeTruthy();
  });
});
