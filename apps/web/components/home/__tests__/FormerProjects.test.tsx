// @vitest-environment happy-dom
/**
 * The card on a former founder's home (security review P2-3): nothing while there is no project to keep; one card per
 * project while its deletion waits, with the day and the last moment; Cancel asks once more, then sends
 * `founder.formerProjects.cancel` and says it is done in place.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const BUSINESS = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
let cards: { businessId: string; businessName: string; scheduledFor: string; until: string }[] = [];
const cancel = vi.fn(async (input: { businessId: string }) => {
  cards = cards.filter((c) => c.businessId !== input.businessId);
  return { canceled: true, businessName: "Bread by Bike", scheduledFor: null };
});

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    founder: {
      formerProjects: {
        list: { queryOptions: () => ({ queryKey: [["founder", "formerProjects", "list"]], queryFn: async () => cards }), queryKey: () => [["founder", "formerProjects", "list"]] },
        cancel: { mutationOptions: (opts: Record<string, unknown>) => ({ mutationKey: [["founder", "formerProjects", "cancel"]], mutationFn: (input: { businessId: string }) => cancel(input), ...opts }) },
      },
    },
  }),
}));

import { FormerProjects } from "../FormerProjects";

const renderIt = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><FormerProjects /></QueryClientProvider>);

afterEach(() => {
  cleanup();
  cards = [];
  cancel.mockClear();
});

describe("FormerProjects", () => {
  it("shows nothing while there is no project to keep", async () => {
    const { container } = renderIt();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("[data-testid=former-projects]")).toBeNull();
  });

  it("one card per project while its deletion waits; Cancel asks once more, then cancels and says so", async () => {
    cards = [{ businessId: BUSINESS, businessName: "Bread by Bike", scheduledFor: "2026-11-20T15:45:00.000Z", until: "2026-11-19T15:45:00.000Z" }];
    renderIt();
    await waitFor(() => expect(screen.getByTestId("former-project-card")).toBeTruthy());
    expect(screen.getByRole("heading").textContent).toBe("Bread by Bike is set to be deleted");
    expect(screen.getByText(/permanently deleted on Nov 20, 2026/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("former-project-cancel"));
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("former-project-confirm"));
    await waitFor(() => expect(screen.getByTestId("former-project-card").getAttribute("data-state")).toBe("done"));
    expect(cancel).toHaveBeenCalledWith({ businessId: BUSINESS });
    expect(screen.getByRole("heading").textContent).toBe("The deletion of Bread by Bike is canceled, and every founder was told.");
  });
});
