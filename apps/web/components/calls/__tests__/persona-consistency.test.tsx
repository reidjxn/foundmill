// @vitest-environment happy-dom
/**
 * The same agent everywhere (docs/TEAM_CALL.md §1): with anthropomorphic agents on, a call tile shows the same persona
 * name, role and portrait URL as the agent profile's header; with it off, the stored name and the drawn portrait.
 * The profile screen is rendered whole (its data seeded), so the comparison is with what the founder really sees there.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPersonaProvider, CallCaptions, CallLobbyPicker, CallStage, CallTile, CallTranscript, ToastProvider, TooltipProvider } from "@foundmill/dugout";
import type { TeamCallParticipantView, TeamCallTurnView } from "@foundmill/shared/team-call";

const BID = "b1e5e5e5-0000-4000-8000-000000000001";
const AGENT_ID = "a1000000-0000-4000-8000-000000000002";

const can = vi.hoisted(() => ({ writeTeam: true }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
vi.mock("@/components/shell/chrome", () => ({ useShellChrome: () => undefined }));
vi.mock("@/components/conversation/DeskHost", () => ({ useAgentDesk: () => ({ open: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/components/shell/business-context", () => ({
  useBusiness: () => ({
    businessId: BID,
    departments: [],
    data: { business: { currency: "USD", spendCapMinor: null } },
    access: { role: "owner", isAdmin: true, canChange: true, isExample: false, canRead: () => true, canWrite: () => can.writeTeam },
  }),
  useBusinessCurrency: () => "USD",
}));

const STORED = { id: AGENT_ID, name: "Product Lead", role: "Product Lead", personaKey: "priya", avatarSeed: "seed-product", layer: "lead", agentType: "product_lead" };
const PROFILE = {
  agent: { ...STORED, status: "healthy", archivedAt: null, currency: "USD", modelKey: "sonnet", wageCapMinor: null, autonomy: null, schedule: null, currentVersionId: null },
  departments: [{ id: "d-product", name: "Product", colourToken: "dept-2" }],
  lineManager: null,
  skills: [],
  trainingRuns: [],
  versions: [],
  traits: [],
  sessions: [],
  wage: { period: "2026-11", costMinor: 0, currency: "USD", wageCapMinor: null },
  recent: { tasksDone: 0 },
  modelLock: false,
};

// A stand-in for the tRPC proxy: every procedure's query answers the profile (or an empty list), mutations do nothing.
vi.mock("@/lib/trpc-react", () => {
  const leaf = (path: string[]) => ({
    queryKey: (input?: unknown) => [path, { input }],
    queryOptions: (input?: unknown) => ({ queryKey: [path, { input }], queryFn: async () => (path.join(".") === "agent.profile.get" ? PROFILE : path.join(".") === "team.agents.list" ? { agents: [], templates: [] } : []) }),
    mutationOptions: () => ({ mutationFn: async () => ({}) }),
  });
  const make = (path: string[]): unknown => new Proxy({}, { get: (_t, key: string) => (["queryKey", "queryOptions", "mutationOptions"].includes(key) ? (leaf(path) as Record<string, unknown>)[key] : make([...path, key])) });
  return { useTRPC: () => make([]) };
});

import { AgentProfileScreen } from "@/components/agents/AgentProfileScreen";

const portraitUrl = (key: string) => `https://portraits.test/${key}.png`;
const participant: TeamCallParticipantView = { agentId: AGENT_ID, ...STORED, colourToken: "dept-2", departmentId: "d-product", speechAccent: "talia", isChiefOfStaff: false };
const turn: TeamCallTurnView = { id: "t1", seq: 1, speaker: "agent", agentId: AGENT_ID, userId: null, text: "Hello.", to: "founder", via: null, createdAt: "2026-11-12T15:00:00Z" };

const wrap = (ui: ReactElement, anthropomorphic: boolean) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider>
      <TooltipProvider>
        <AgentPersonaProvider anthropomorphic={anthropomorphic} style="humans" portraitUrl={portraitUrl}>
          {ui}
        </AgentPersonaProvider>
      </TooltipProvider>
    </ToastProvider>
  </QueryClientProvider>
);

const photo = (root: HTMLElement) => root.querySelector<HTMLImageElement>('img[data-avatar="photo"]')?.getAttribute("src") ?? null;

afterEach(() => cleanup());

async function profileHeader(anthropomorphic: boolean) {
  const view = render(wrap(<AgentProfileScreen agentId={AGENT_ID} tab="logs" />, anthropomorphic));
  const header = await screen.findByTestId("profile-header");
  await waitFor(() => expect(header.querySelector("h1")?.textContent).toBeTruthy());
  return { view, header };
}

describe("Team call shows the agent as the profile does", () => {
  it("persona on: the tile's name, role and portrait URL are the profile header's", async () => {
    const { header, view } = await profileHeader(true);
    const name = header.querySelector("h1")!.textContent!;
    const role = header.querySelector("[data-testid=profile-header] .flex.flex-wrap.items-center.gap-1 > *")?.textContent;
    const headerPhoto = photo(header);
    expect(name).toBe("Priya");
    expect(headerPhoto).toBe("https://portraits.test/priya.png");
    view.unmount();

    const tile = render(wrap(<CallTile participant={participant} />, true));
    expect(screen.getByTestId("call-name").textContent).toBe(name);
    expect(screen.getByTestId("call-role").textContent).toBe(role);
    expect(photo(tile.container)).toBe(headerPhoto);
  });

  it("persona off: the stored name and the drawn portrait, as on the profile", async () => {
    const { header, view } = await profileHeader(false);
    expect(header.querySelector("h1")!.textContent).toBe("Product Lead");
    expect(photo(header)).toBeNull();
    view.unmount();

    const tile = render(wrap(<CallTile participant={participant} />, false));
    expect(screen.getByTestId("call-name").textContent).toBe("Product Lead");
    expect(photo(tile.container)).toBeNull();
  });

  it("the stage, the lobby, the captions and the transcript name the agent the same way (no surface computes its own)", () => {
    const view = render(
      wrap(
        <>
          <CallStage kind="team" participants={[participant]} />
          <CallLobbyPicker agents={[participant]} selected={[]} onChange={() => undefined} />
          <CallCaptions speaker={participant} text="Hello." />
          <CallTranscript turns={[turn]} participants={[participant]} />
        </>,
        true,
      ),
    );
    expect(within(screen.getByTestId("call-stage")).getByTestId("call-name").textContent).toBe("Priya");
    expect(screen.getByTestId("call-lobby-name").textContent).toBe("Priya");
    expect(screen.getByTestId("call-captions-speaker").textContent).toContain("Priya");
    expect(screen.getByTestId("call-turn-speaker").textContent).toContain("Priya");
    expect(photo(view.container)).toBe("https://portraits.test/priya.png");
  });

  it("the profile header offers Chat with the persona name and Call", async () => {
    const { header } = await profileHeader(true);
    expect(within(header).getByTestId("header-talk").textContent).toContain("Chat with Priya");
    expect(within(header).getByTestId("header-call").textContent).toContain("Call Priya");
  });

  it("Call is hidden for anyone who cannot write the Team section; Chat stays", async () => {
    can.writeTeam = false;
    try {
      const { header } = await profileHeader(true);
      expect(within(header).queryByTestId("header-call")).toBeNull();
      expect(within(header).getByTestId("header-talk")).toBeTruthy();
    } finally {
      can.writeTeam = true;
    }
  });
});
