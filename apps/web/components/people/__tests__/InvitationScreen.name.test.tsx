// @vitest-environment happy-dom
/**
 * After Accept, a new account names itself on the card and goes to Today (WP-12 T2): `invitation.accept` says whether
 * the account has a profile; with one it goes straight in, without one the card asks one thing and never sends the
 * person to /onboarding.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";

const accept = vi.fn();
const update = vi.fn();
const push = vi.fn();

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: {
      adult: { get: { queryOptions: (_i: unknown, opts: Record<string, unknown>) => ({ queryKey: [["founder", "adult", "get"]], queryFn: async () => ({ confirmed: true }), ...opts }) } },
      profile: { update: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["founder", "profile", "update"]], mutationFn: (vars: unknown) => update(vars), ...opts }) } },
    },
    invitation: {
      accept: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["invitation", "accept"]], mutationFn: (vars: unknown) => accept(vars), ...opts }) },
      decline: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["invitation", "decline"]], mutationFn: async () => ({ ok: true }), ...opts }) },
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (to: string) => push(to), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/i/tok" }));

import { InvitationScreen, INVITATION_NAME_HINT, INVITATION_NAME_LABEL } from "../InvitationScreen";

const PENDING = { state: "pending", projectName: "Bread by Bike", inviterName: "Sam Lee", role: "collaborator", roleWord: "Collaborator", roleSentence: "Help with the project." } as const;

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TooltipProvider>
          <InvitationScreen token="tok" signedIn preview={PENDING} adultConfirmed />
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
const press = async (id: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId(id));
  });
};

beforeEach(() => {
  accept.mockReset();
  update.mockReset().mockResolvedValue({});
  push.mockReset();
});
afterEach(() => cleanup());

describe("InvitationScreen: naming yourself", () => {
  it("a person with a profile goes to Today at once and never sees the field", async () => {
    accept.mockResolvedValue({ businessId: "b1", already: false, hasProfile: true });
    renderScreen();
    await press("invitation-accept");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/b/b1/today"));
    expect(screen.queryByTestId("invitation-name")).toBeNull();
  });

  it("a new person sees one field; an empty name is refused in place; Continue saves the trimmed name, then Today", async () => {
    accept.mockResolvedValue({ businessId: "b1", already: false, hasProfile: false });
    renderScreen();
    await press("invitation-accept");
    await waitFor(() => expect(screen.getByTestId("invitation-name")).toBeTruthy());
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText(INVITATION_NAME_LABEL)).toBeTruthy();
    expect(screen.getByText(INVITATION_NAME_HINT)).toBeTruthy();

    await press("invitation-continue");
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Enter a name");

    fireEvent.change(screen.getByLabelText(INVITATION_NAME_LABEL), { target: { value: "  Dana Reyes  " } });
    await press("invitation-continue");
    await waitFor(() => expect(update).toHaveBeenCalledWith({ displayName: "Dana Reyes" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/b/b1/today"));
  });
});
