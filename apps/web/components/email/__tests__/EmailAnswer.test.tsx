// @vitest-environment happy-dom
/**
 * `/a/<token>` on a phone (WP-04 T14): while the link is read the page shows a three-line skeleton, both buttons are
 * tap-sized (`min-h-tap`, 44 px), and an answer that fails says so in place with Try again instead of doing nothing.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";

const getAction = vi.fn();
const answerAction = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => "/a/token" }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    email: {
      action: {
        get: { queryOptions: (input: unknown) => ({ queryKey: [["email", "action", "get"], { input }], queryFn: () => getAction(input) }) },
        answer: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationKey: [["email", "action", "answer"]], mutationFn: (vars: unknown) => answerAction(vars), ...opts }) },
      },
    },
  }),
}));

import { EmailAnswer } from "../EmailAnswer";

const READY = { kind: "answer", state: "ready", businessName: "Northwind", subject: "Pick a launch day", optionLabel: "Tuesday", consequence: null, businessId: "b1", itemId: "i1", scheduledFor: null, until: null };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider renderViewport={false}>
          <EmailAnswer token="token" />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("EmailAnswer on a phone", () => {
  beforeEach(() => {
    getAction.mockReset().mockResolvedValue(READY);
    answerAction.mockReset();
  });

  it("shows a three-line skeleton while the link is read, never a bare Loading", async () => {
    getAction.mockReturnValue(new Promise(() => {}));
    renderPage();
    const loading = await screen.findByTestId("email-answer-loading");
    expect(loading.querySelectorAll("[data-skeleton]")).toHaveLength(3);
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("the answer button is tap-sized and fills a phone's width", async () => {
    renderPage();
    const button = await screen.findByRole("button", { name: "Answer “Tuesday”" });
    expect(button.className).toMatch(/\bmin-h-tap\b/);
    expect(button.className).toMatch(/\bw-full\b/);
    expect(button.className).toMatch(/@page-wide:w-auto/);
  });

  it("the Open Needs you button is tap-sized too", async () => {
    getAction.mockResolvedValue({ ...READY, state: "used" });
    renderPage();
    const link = await screen.findByRole("link", { name: "Open Needs you" });
    expect(link.className).toMatch(/\bmin-h-tap\b/);
    expect(link.className).toMatch(/\bw-full\b/);
  });

  it("a failed answer says so in place, and Try again sends it again", async () => {
    answerAction.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ ...READY, state: "answered", requiresConfirmation: false });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Answer “Tuesday”" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That did not go through. Try again.");
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry.className).toMatch(/\bmin-h-tap\b/);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId("email-answer").getAttribute("data-state")).toBe("answered"));
    expect(answerAction).toHaveBeenCalledTimes(2);
    expect(answerAction).toHaveBeenLastCalledWith({ token: "token" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Done")).toBeTruthy();
  });
});
