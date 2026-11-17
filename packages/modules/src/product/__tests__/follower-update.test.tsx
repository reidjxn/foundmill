import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { PROJECT_UPDATE_WORDS as W } from "@foundmill/shared/project-updates";
import { FollowerUpdatePanel, type UpdatePreviewResponse, type UpdatesListResponse } from "../FollowerUpdatePanel";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID } from "./fixtures";

const draft = { id: "11111111-1111-4111-8111-111111111111", subject: "Our first batch", body: "It shipped today.", status: "draft" as const, draftedByAgentId: "22222222-2222-4222-8222-222222222222", sentCount: 0, skippedCount: 0, remainingCount: 0, updatedAt: "2026-11-16T12:00:00.000Z" };
const list = (over: Partial<UpdatesListResponse> = {}): UpdatesListResponse => ({ followers: 3, canSend: true, updates: [], ...over });
const preview = (over: Partial<UpdatePreviewResponse> = {}): UpdatePreviewResponse => ({ subject: draft.subject, text: "It shipped today.\n\nWritten with help from AI and checked by Maya.", footer: "--\nSent by Candle Co with Foundmill. PO Box 1234, Springfield, IL 62701, USA", followers: 3, perDay: 50, postalAddressMissing: false, ...over });

const render = (l: UpdatesListResponse, p: UpdatePreviewResponse = preview(), onMutate?: (path: string, input: Record<string, unknown>) => unknown) => {
  const fake = createFakeSource({ businessId: BID, responses: { "updates.list": l, "updates.preview": p }, onMutate });
  renderScreen(fake, <FollowerUpdatePanel projectName="Candle Co" />);
  return fake;
};

describe("FollowerUpdatePanel (WP-08 T3)", () => {
  it("with no followers says what will happen, and offers no send", async () => {
    render(list({ followers: 0 }));
    expect((await screen.findByTestId("follower-update-empty")).textContent).toBe(W.noFollowers);
    expect(screen.queryByTestId("follower-update-write")).toBeNull();
    expect(screen.queryByTestId("follower-update-send")).toBeNull();
  });

  it("a founder writes a draft from the button with the follower count", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    render(list(), preview(), (path, input) => (calls.push([path, input]), {}));
    fireEvent.click(await screen.findByRole("button", { name: W.button(3) }));
    fireEvent.change(screen.getByTestId("follower-update-subject"), { target: { value: "News" } });
    fireEvent.change(screen.getByTestId("follower-update-body"), { target: { value: "We shipped." } });
    fireEvent.click(screen.getByTestId("follower-update-save"));
    await waitFor(() => expect(calls).toContainEqual(["updates.save", { subject: "News", body: "We shipped." }]));
  });

  it("shows exactly what goes out, confirms with the count, and says what the api answered", async () => {
    const calls: string[] = [];
    render(list({ updates: [draft] }), preview(), (path) => (calls.push(path), path === "updates.send" ? { sent: 3, remaining: 0, simulated: false, refusal: null, message: W.sent(3) } : {}));
    const shown = await screen.findByTestId("follower-update-preview");
    expect(shown.textContent).toContain("Written with help from AI and checked by Maya.");
    expect(shown.textContent).toContain("PO Box 1234");
    fireEvent.click(screen.getByTestId("follower-update-send"));
    expect((await screen.findByText(W.confirm(3, "Candle Co"))).textContent).toBe("This goes to 3 people who asked to hear from Candle Co. It cannot be unsent.");
    expect(calls).not.toContain("updates.send");
    fireEvent.click(screen.getByTestId("follower-update-confirm"));
    expect((await screen.findByTestId("follower-update-notice")).textContent).toBe("Sent to 3 people.");
  });

  it("without a postal address it says so and Send waits; a member who cannot send sees no Send", async () => {
    render(list({ updates: [draft] }), preview({ postalAddressMissing: true }));
    expect((await screen.findByTestId("follower-update-postal")).textContent).toBe(`${W.postalAddressTitle}${W.postalAddressMissing}`);
    expect((screen.getByTestId("follower-update-send") as HTMLButtonElement).disabled).toBe(true);
  });

  it("says why a postal address comes first before anyone writes, and still lets them write", async () => {
    render(list({ postalAddressMissing: true }));
    expect((await screen.findByTestId("follower-update-postal")).textContent).toContain("US law asks every email that tells people about a business to include a postal address");
    expect(screen.getByRole("button", { name: W.button(3) })).toBeTruthy();
  });

  it("a member who cannot send sees no Send button", async () => {
    render(list({ updates: [draft], canSend: false }));
    await screen.findByTestId("follower-update-preview");
    expect(screen.queryByTestId("follower-update-send")).toBeNull();
  });

  it("an unfinished send offers Send the rest", async () => {
    render(list({ updates: [{ ...draft, status: "sending", sentCount: 50, remainingCount: 12 }] }));
    expect((await screen.findByTestId("follower-update-send")).textContent).toContain(W.sendRest);
  });
});
