// @vitest-environment happy-dom
/**
 * Gmail and Google Calendar as context (founder, Nov 19, 2026): the panel shows only for a connected Gmail or Calendar,
 * says the inbox waits for Google's inbox permission, saves through `integrations.setContextReads`, and is read-only for
 * a collaborator.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as SharedModule from "../shared";

const setContextReads = vi.fn(async (_vars: unknown) => ({}));
const toast = { saved: vi.fn(), failed: vi.fn(), info: vi.fn() };

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({ integrations: { setContextReads: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["integrations", "setContextReads"]], mutationFn: (vars: unknown) => setContextReads(vars), ...opts }) } } }),
}));
vi.mock("../shared", async (importOriginal) => ({ ...(await importOriginal<typeof SharedModule>()), useSettingsToast: () => toast }));
vi.mock("../SettingsScreen", () => ({ useInvalidateRouters: () => async () => undefined }));

import { GMAIL_COMPOSE_SCOPE, GMAIL_READONLY_SCOPE, gmailReadsLine, GoogleContextPanel } from "../GoogleContextPanel";

const gmail = (settings: Record<string, unknown> = {}, scopes: string[] = []) => ({ key: "gmail", integration: { status: "connected", scopes, settings } });
const renderPanel = (rows: Parameters<typeof GoogleContextPanel>[0]["rows"], canEdit = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <GoogleContextPanel businessId="b1" rows={rows} canEdit={canEdit} />
    </QueryClientProvider>,
  );

afterEach(() => vi.clearAllMocks());

describe("GoogleContextPanel", () => {
  it("shows nothing when neither Gmail nor Calendar is connected", () => {
    renderPanel([{ key: "gmail", integration: null }, { key: "google_calendar", integration: { status: "disconnected", scopes: [] } }]);
    expect(screen.queryByTestId("google-context")).toBeNull();
  });

  it("says the inbox waits for Google's inbox permission", () => {
    expect(gmailReadsLine([])).toMatch(/^Nothing yet\./);
    expect(gmailReadsLine([GMAIL_COMPOSE_SCOPE])).toMatch(/drafts\. Your inbox is read once Google grants inbox access/);
    expect(gmailReadsLine([GMAIL_READONLY_SCOPE, GMAIL_COMPOSE_SCOPE])).toBe("Your drafts and your inbox.");
  });

  it("a founder turns Gmail on", async () => {
    renderPanel([gmail()]);
    expect(screen.getByTestId("google-context").textContent).toMatch(/sending mail and inviting people run on their own, unless you chose to be asked before anything outside the business/);
    await act(async () => void fireEvent.click(screen.getByRole("checkbox", { name: /Let the team read your Gmail/ })));
    expect(setContextReads).toHaveBeenCalledWith(expect.objectContaining({ businessId: "b1", connectorKey: "gmail", on: true }));
  });

  it("a collaborator sees it but cannot change it", () => {
    renderPanel([gmail({ contextReads: true }), { key: "google_calendar", integration: { status: "connected", scopes: [] } }], false);
    const box = screen.getByRole("checkbox", { name: /Let the team read your Gmail/ });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Only the project's founders can change this.")).toBeTruthy();
  });
});
