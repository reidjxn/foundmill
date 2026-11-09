// @vitest-environment happy-dom
/**
 * AskChief, the shell's host for "Ask <Chief of Staff>": nothing for a business without a Chief of Staff, the real
 * Chief of Staff's name under the reader's preference otherwise, the answer for the page the founder is on, and the
 * desk for "Continue in chat" and "Ask something else…".
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPersonaProvider, EntityLinkProvider, Explainer, GuidanceProvider, PageExplainProvider } from "@foundmill/dugout";
import type { AgentDeskApi } from "@/components/conversation/DeskHost";

const BUSINESS = "b1e5e5e5-0000-4000-8000-000000000001";
const CHIEF = { id: "c0c0c0c0-0000-4000-8000-000000000001", name: "Ines Park", role: "Chief of Staff", avatarSeed: "ines", personaKey: "ines", layer: "assistant", departmentId: null as string | null };
const AGENT = "11111111-1111-4111-8111-111111111111";

let who: typeof CHIEF | null = CHIEF;
let pathname = "/b/b1e5e5e5-0000-4000-8000-000000000001/today";
const answer = vi.fn(async (input: { question: string; page: { path: string; area?: string | null; purpose?: string | null } }) => ({ question: input.question, text: `[[ent:${AGENT}|Juno Reyes]] answers ${input.question}.`, chiefOfStaff: who, today: "2026-11-09" }));

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    chiefOfStaff: {
      who: { queryOptions: (_i: unknown, opts: Record<string, unknown>) => ({ queryKey: ["who"], queryFn: async () => who, ...opts }) },
      answer: { queryOptions: (input: Parameters<typeof answer>[0], opts: Record<string, unknown>) => ({ queryKey: ["answer", input], queryFn: () => answer(input), ...opts }) },
    },
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/components/conversation/DeskHost", () => ({ prefetchAgentDesk: vi.fn() }));
vi.mock("../business-context", () => ({
  useBusiness: () => ({ businessId: BUSINESS, departments: [{ id: "d1", slug: "finance", colourToken: "dept-2", moduleKeys: ["finance"], lead: null, squad: [{ id: AGENT, name: "Juno Reyes", role: "Engineer", personaKey: "juno", layer: "worker" }] }] }),
}));

import { AskChief } from "../AskChief";

const open = vi.fn();
const desk = { current: { open, close: vi.fn(), prefetch: vi.fn(), current: null } as AgentDeskApi };

function mount(children?: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgentPersonaProvider anthropomorphic={false}>
        <EntityLinkProvider value={{}}>
          <GuidanceProvider>
            <PageExplainProvider>
              <AskChief desk={desk} />
              {children}
            </PageExplainProvider>
          </GuidanceProvider>
        </EntityLinkProvider>
      </AgentPersonaProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  who = CHIEF;
  pathname = `/b/${BUSINESS}/today`;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("AskChief", () => {
  it("draws nothing for a business without a Chief of Staff", async () => {
    who = null;
    mount();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("ask-chief-trigger")).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });

  it("is named for the real Chief of Staff, as the reader's naming preference shows it", async () => {
    mount();
    expect(await screen.findByRole("button", { name: "Ask Ines Park" })).toBeTruthy();
  });

  it("answers a question for this page: the path and area go with it, the mention is a link", async () => {
    pathname = `/b/${BUSINESS}/d/finance/overview`;
    mount(<Explainer screenId="finance/overview" purpose="How many months your cash lasts." action="Compare the scenarios." watchFor="A runway under 9 months." />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Ines Park" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "What's blocking us?" }));
    const text = await screen.findByTestId("ask-chief-text");
    expect(text.textContent).toContain("Juno Reyes answers blocking.");
    expect(text.textContent).not.toContain("[[");
    expect(answer).toHaveBeenCalledWith({ businessId: BUSINESS, question: "blocking", page: { path: `/b/${BUSINESS}/d/finance/overview`, screenId: "finance/overview", area: "money", purpose: "How many months your cash lasts." } });
  });

  it("asks nothing until a question is picked", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Ines Park" }));
    await screen.findByTestId("ask-chief-menu");
    expect(answer).not.toHaveBeenCalled();
  });

  it("Continue in chat opens the Chief of Staff's desk with the question", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Ines Park" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Why am I seeing this?" }));
    await screen.findByTestId("ask-chief-text");
    fireEvent.click(screen.getByRole("button", { name: "Continue in chat" }));
    expect(open).toHaveBeenCalledWith({ kind: "agent", id: CHIEF.id }, { persona: { name: "Ines Park", role: "Chief of Staff", avatarSeed: "ines", personaKey: "ines", dept: "dept-2" }, text: "Why am I seeing this?" });
  });

  it("Ask something else opens the desk with nothing typed", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Ines Park" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ask something else…" }));
    expect(open).toHaveBeenCalledWith({ kind: "agent", id: CHIEF.id }, expect.objectContaining({ text: null }));
  });

  it("shows a message and Try again when the answer fails, then the answer", async () => {
    answer.mockRejectedValueOnce(new Error("boom"));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ask Ines Park" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "What's happening?" }));
    await waitFor(() => expect(screen.getByTestId("ask-chief-error")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByTestId("ask-chief-text")).textContent).toContain("answers happening.");
  });
});
