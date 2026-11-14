// @vitest-environment happy-dom
/**
 * 18 or older on an invitation (0100): only a confirmation the api reported hides the box. While `founder.adult.get`
 * is asked, Accept waits; if it fails, the box shows; if Accept is refused with `adult_unconfirmed`, the box shows and
 * the next Accept carries `confirmAdult: true`.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";

const adultGet = vi.fn();
const accept = vi.fn();
const push = vi.fn();

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: { adult: { get: { queryOptions: (_input: unknown, opts: Record<string, unknown>) => ({ queryKey: [["founder", "adult", "get"]], queryFn: () => adultGet(), ...opts }) } } },
    invitation: {
      accept: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["invitation", "accept"]], mutationFn: (vars: unknown) => accept(vars), ...opts }) },
      decline: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["invitation", "decline"]], mutationFn: async () => ({ ok: true }), ...opts }) },
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: (to: string) => push(to), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/i/tok" }));

import { InvitationScreen, INVITATION_ADULT_NEEDED } from "../InvitationScreen";

const PENDING = { state: "pending", projectName: "Bread by Bike", inviterName: "Sam Lee", role: "collaborator", roleWord: "Collaborator", roleSentence: "Help with the project." } as const;
const refusedAdult = () => Object.assign(new Error("Foundmill is for people 18 or older."), { data: { code: "FORBIDDEN", appCode: "adult_unconfirmed" } });

function renderScreen(props: Partial<React.ComponentProps<typeof InvitationScreen>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TooltipProvider>
          <InvitationScreen token="tok" signedIn preview={PENDING} {...props} />
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  adultGet.mockReset();
  accept.mockReset().mockResolvedValue({ businessId: "b1", already: false });
  push.mockReset();
});
afterEach(() => cleanup());

describe("InvitationScreen and 18 or older", () => {
  it("a confirmation on record hides the box, and Accept sends nothing about it", async () => {
    adultGet.mockResolvedValue({ confirmed: true, confirmedAt: "2026-11-14T10:00:00.000Z" });
    renderScreen();
    await waitFor(() => expect((screen.getByTestId("invitation-accept") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("invitation-adult")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("invitation-accept"));
    });
    await waitFor(() => expect(accept).toHaveBeenCalledWith({ token: "tok" }));
  });

  it("when founder.adult.get fails the box shows, and Accept waits for it", async () => {
    adultGet.mockRejectedValue(new Error("no answer"));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId("invitation-adult")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByTestId("invitation-accept"));
    });
    expect(accept).not.toHaveBeenCalled();
    expect(screen.getByTestId("invitation-adult").textContent).toContain(INVITATION_ADULT_NEEDED);
    fireEvent.click(screen.getByRole("checkbox", { name: "I am 18 or older" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("invitation-accept"));
    });
    await waitFor(() => expect(accept).toHaveBeenCalledWith({ token: "tok", confirmAdult: true }));
  });

  it("an Accept refused with adult_unconfirmed shows the box, even when the page was told it was on record", async () => {
    accept.mockReset().mockRejectedValueOnce(refusedAdult()).mockResolvedValue({ businessId: "b1", already: false });
    renderScreen({ adultConfirmed: true });
    expect(screen.queryByTestId("invitation-adult")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId("invitation-accept"));
    });
    await waitFor(() => expect(screen.getByTestId("invitation-adult")).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "I am 18 or older" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("invitation-accept"));
    });
    await waitFor(() => expect(accept).toHaveBeenLastCalledWith({ token: "tok", confirmAdult: true }));
    await waitFor(() => expect(push).toHaveBeenCalled());
  });
});
