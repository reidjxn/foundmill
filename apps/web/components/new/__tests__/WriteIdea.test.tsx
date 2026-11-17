// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WRITE_IDEA_WORDS } from "@foundmill/dugout";

const push = vi.fn();
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/new/write",
}));

const IDEA_ID = "6f1c2a7e-1111-4000-8000-000000000001";
const write = vi.fn(async (_input: unknown) => ({ idea: { id: IDEA_ID } }));
vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    idea: { write: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationFn: (input: unknown) => write(input), ...opts }) } },
  }),
}));

import { WriteIdea } from "../WriteIdea";

function renderWrite() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WriteIdea viewer={{ email: "maya@example.com" }} />
    </QueryClientProvider>,
  );
}

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.dispatchEvent(new Event("resize"));
}

afterEach(() => {
  write.mockClear();
  push.mockReset();
  setWidth(1440);
});

describe("WriteIdea: a phone start without a card (WP-04 T15)", () => {
  it("asks what you want to build, at 390 px, with a working name, the idea and Shape it", () => {
    setWidth(390);
    renderWrite();
    expect(screen.queryByTestId("needs-larger-window")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("What do you want to build?");
    expect(screen.getByText("One sentence is enough.")).toBeTruthy();
    expect(screen.getByLabelText(/A working name/)).toBeTruthy();
    expect(screen.getByLabelText(/Your idea, in your words/)).toBeTruthy();
    expect(screen.getByRole("button", { name: WRITE_IDEA_WORDS.submit }).textContent).toBe("Shape it");
  });

  it("calls idea.write once and goes to Commit, however often Shape it is pressed", async () => {
    renderWrite();
    fireEvent.change(screen.getByLabelText(/A working name/), { target: { value: "Plant swap" } });
    fireEvent.change(screen.getByLabelText(/Your idea, in your words/), { target: { value: "Neighbors trade cuttings." } });
    const button = screen.getByRole("button", { name: "Shape it" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/new/commit/${IDEA_ID}`));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ title: "Plant swap", pitch: "Neighbors trade cuttings.", archetype: null });
  });

  it("sends nothing with an empty idea", () => {
    renderWrite();
    fireEvent.change(screen.getByLabelText(/A working name/), { target: { value: "Plant swap" } });
    fireEvent.click(screen.getByRole("button", { name: "Shape it" }));
    expect(write).not.toHaveBeenCalled();
  });
});
