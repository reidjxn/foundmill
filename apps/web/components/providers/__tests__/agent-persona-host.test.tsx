// @vitest-environment happy-dom
/**
 * AgentPersonaHost: with the account's switch on it asks `team.personas.ensure` for the business, uses a face only for a
 * key in `ready` (from the API's public /personas/<style>/<key>; the style defaults to humans), asks again every 15 s while any is pending (a key refused for
 * good, in `failed`, keeps the drawn portrait and is not polled for), and with the switch off asks nothing and leaves every
 * name and portrait as it was.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar, useAgentPersona } from "@foundmill/dugout";
import { characterFor, type AgentStyle } from "@foundmill/shared/personas";
import type * as GuidanceContext from "../guidance-context";

const BUSINESS = "b1e5e5e5-0000-4000-8000-000000000001";
const ENSURE_KEY = (businessId: string) => [["team", "personas", "ensure"], { input: { businessId }, type: "query" }];

let anthropomorphicAgents = true;
let agentStyle: AgentStyle | undefined;
let ensureAnswer: PersonaPortraitStatus = { ready: ["malik"], pending: ["amara"], failed: [] };
const ensure = vi.fn(async (_input: { businessId: string }) => ensureAnswer);

vi.mock("@/lib/trpc-react", () => ({
  useTRPC: () => ({
    team: {
      personas: {
        ensure: {
          queryOptions: (input: { businessId: string }, opts: Record<string, unknown>) => ({ queryKey: ENSURE_KEY(input.businessId), queryFn: () => ensure(input), ...opts }),
        },
      },
    },
  }),
}));
vi.mock("../guidance-context", async (importOriginal) => ({ ...(await importOriginal<typeof GuidanceContext>()), useGuidancePreferences: () => ({ prefs: { anthropomorphicAgents, agentStyle } }) }));

import { AgentPersonaHost, PERSONA_POLL_MS, PERSONA_STYLE_RECHECK_MS, personaPortraitUrl, personaRefetchInterval, type PersonaPortraitStatus } from "../AgentPersonaHost";

function Probe() {
  const p = useAgentPersona();
  const cos = { name: "Chief of Staff", role: "Chief of Staff", personaKey: "malik" };
  return (
    <>
      <p data-testid="label">{p.labelFor(cos)}</p>
      <Avatar name="Chief of Staff" agent={{ seed: "cos", dept: "dept-1", personaKey: "malik" }} />
      <Avatar name="Growth" agent={{ seed: "g", dept: "dept-3", personaKey: "amara" }} />
    </>
  );
}

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgentPersonaHost businessId={BUSINESS} apiUrl="http://localhost:4000/">
        <Probe />
      </AgentPersonaHost>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  anthropomorphicAgents = true;
  agentStyle = undefined;
  ensureAnswer = { ready: ["malik"], pending: ["amara"], failed: [] };
  ensure.mockClear();
});

describe("AgentPersonaHost", () => {
  it("on: names agents by first name with the position, and shows the face only for a ready key", async () => {
    const { container } = mount();
    expect(screen.getByTestId("label").textContent).toBe("Malik (Chief of Staff)");
    await waitFor(() => expect(container.querySelectorAll("img[data-avatar='photo']")).toHaveLength(1));
    expect(container.querySelector("img[data-avatar='photo']")?.getAttribute("src")).toBe("http://localhost:4000/personas/humans/malik");
    // The drawn portrait stays under every face (and alone for the pending key) until its face is ready.
    expect(container.querySelectorAll("svg[data-avatar='portrait']")).toHaveLength(2);
    expect(ensure).toHaveBeenCalledWith({ businessId: BUSINESS });
  });

  it("on: a key refused for good keeps the drawn portrait, and with nothing pending it asks only once", async () => {
    ensureAnswer = { ready: ["malik"], pending: [], failed: ["amara"] };
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll("img[data-avatar='photo']")).toHaveLength(1));
    expect(container.querySelector("img[data-avatar='photo']")?.getAttribute("src")).toBe("http://localhost:4000/personas/humans/malik");
    expect(container.querySelectorAll("svg[data-avatar='portrait']")).toHaveLength(2);
    expect(personaRefetchInterval(ensureAnswer)).toBe(false);
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it("a style names the agent by its character there and loads the face from that style's route", async () => {
    agentStyle = "fantasy";
    ensureAnswer = { style: "fantasy", ready: ["malik"], pending: [], failed: [] };
    const { container } = mount();
    expect(screen.getByTestId("label").textContent).toBe(`${characterFor("malik", "fantasy")!.name} (Chief of Staff)`);
    await waitFor(() => expect(container.querySelectorAll("img[data-avatar='photo']")).toHaveLength(1));
    expect(container.querySelector("img[data-avatar='photo']")?.getAttribute("src")).toBe("http://localhost:4000/personas/fantasy/malik");
  });

  it("an answer made for another style is not used, and is asked for again soon", async () => {
    agentStyle = "cartoon_2d";
    ensureAnswer = { style: "humans", ready: ["malik"], pending: [], failed: [] };
    const { container } = mount();
    await waitFor(() => expect(ensure).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector("img[data-avatar='photo']")).toBeNull();
    expect(personaRefetchInterval(ensureAnswer, "cartoon_2d")).toBe(PERSONA_STYLE_RECHECK_MS);
    expect(personaRefetchInterval(ensureAnswer, "humans")).toBe(false);
    expect(personaRefetchInterval({ ready: [], pending: [], failed: [] }, "humans")).toBe(false);
  });

  it("choosing another style asks the API again instead of reusing the first style's answer", async () => {
    ensureAnswer = { style: "humans", ready: ["malik"], pending: [], failed: [] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <AgentPersonaHost businessId={BUSINESS} apiUrl="http://localhost:4000/">
          <Probe />
        </AgentPersonaHost>
      </QueryClientProvider>
    );
    const { container, rerender } = render(tree());
    await waitFor(() => expect(container.querySelectorAll("img[data-avatar='photo']")).toHaveLength(1));
    expect(ensure).toHaveBeenCalledTimes(1);
    // tRPC reads the request from the key's two elements, so the style rides inside the second one.
    const keys = client.getQueryCache().getAll().map((q) => q.queryKey);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toHaveLength(2);
    expect(keys[0]![0]).toEqual(["team", "personas", "ensure"]);
    expect(keys[0]![1]).toMatchObject({ input: { businessId: BUSINESS }, type: "query", agentStyle: "humans" });
    agentStyle = "fantasy";
    ensureAnswer = { style: "fantasy", ready: ["malik"], pending: [], failed: [] };
    rerender(tree());
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.querySelector("img[data-avatar='photo']")?.getAttribute("src")).toBe("http://localhost:4000/personas/fantasy/malik"));
  });

  it("off: asks nothing, and every name and portrait is today's", async () => {
    anthropomorphicAgents = false;
    const { container } = mount();
    expect(screen.getByTestId("label").textContent).toBe("Chief of Staff");
    await new Promise((r) => setTimeout(r, 30));
    expect(ensure).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("svg[data-avatar='portrait']")).toHaveLength(2);
  });
});

describe("persona polling and URLs", () => {
  it("polls every 15 seconds while faces are pending, and stops once all are ready", () => {
    expect(PERSONA_POLL_MS).toBe(15_000);
    expect(personaRefetchInterval({ pending: ["amara"] })).toBe(15_000);
    expect(personaRefetchInterval({ pending: [] })).toBe(false);
    // Failed keys are never waited on.
    expect(personaRefetchInterval({ ready: [], pending: [], failed: ["amara"] })).toBe(false);
    expect(personaRefetchInterval({ ready: [], pending: ["mei"], failed: ["amara"] })).toBe(15_000);
    expect(personaRefetchInterval(undefined)).toBe(false);
  });

  it("builds the face URL from the API origin and the key", () => {
    expect(personaPortraitUrl("https://api.foundmill.com", "malik")).toBe("https://api.foundmill.com/personas/humans/malik");
    expect(personaPortraitUrl("https://api.foundmill.com/", "malik")).toBe("https://api.foundmill.com/personas/humans/malik");
    expect(personaPortraitUrl("https://api.foundmill.com", "malik", "cartoon_3d")).toBe("https://api.foundmill.com/personas/cartoon_3d/malik");
  });
});
