/**
 * Story and test content for the Team call components: Northwind Skincare's team on a call on Nov 12, 2026. Not exported
 * from the package barrel.
 */
import type { Decorator } from "@storybook/react-vite";
import type { TeamCallActionView, TeamCallParticipantView, TeamCallTurnView } from "@foundmill/shared/team-call";
import { AgentPersonaProvider } from "../foundation/AgentPersona";

export const FOUNDER_NAME = "Maya Okafor";

const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const AGENT_IDS = { cos: id(1), product: id(2), growth: id(3), finance: id(4), support: id(5) } as const;

const agent = (agentId: string, name: string, personaKey: string, avatarSeed: string, colourToken: string | null, departmentId: string | null, speechAccent: string, isChiefOfStaff = false): TeamCallParticipantView => ({
  agentId,
  name,
  role: name,
  personaKey,
  avatarSeed,
  layer: isChiefOfStaff ? "executive" : "lead",
  agentType: isChiefOfStaff ? "chief_of_staff" : "lead",
  colourToken,
  departmentId,
  speechAccent,
  isChiefOfStaff,
});

/** A team call of five agents. */
export const TEAM_CALL_AGENTS: TeamCallParticipantView[] = [
  agent(AGENT_IDS.cos, "Chief of Staff", "malik", "seed-cos", null, null, "darian", true),
  agent(AGENT_IDS.product, "Product Lead", "priya", "seed-product", "dept-2", "dept-product", "talia"),
  agent(AGENT_IDS.growth, "Growth Lead", "amara", "seed-growth", "dept-3", "dept-growth", "elara"),
  agent(AGENT_IDS.finance, "Finance Lead", "kenji", "seed-finance", "dept-4", "dept-finance", "baxter"),
  agent(AGENT_IDS.support, "Support Lead", "sofia", "seed-support", "dept-5", "dept-support", "elowen"),
];

export const ONE_TO_ONE_AGENT = TEAM_CALL_AGENTS[1]!;

export const DEPARTMENT_NAMES: Record<string, string> = {
  "dept-product": "Product",
  "dept-growth": "Customers",
  "dept-finance": "Finance",
  "dept-support": "Support",
};

const mention = (agentId: string, name: string) => `[[ent:${agentId}|${name}]]`;
const at = (m: number, s = 0) => `2026-11-12T15:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}Z`;

export const TEAM_CALL_TURNS: TeamCallTurnView[] = [
  { id: "t1", seq: 1, speaker: "agent", agentId: AGENT_IDS.cos, userId: null, text: "Hi Maya. What is on your mind today?", to: "founder", via: null, createdAt: at(2) },
  { id: "t2", seq: 2, speaker: "founder", agentId: null, userId: "u1", text: "I want to open the waitlist next week. What do we need?", to: null, via: "spoken", createdAt: at(3) },
  {
    id: "t3",
    seq: 3,
    speaker: "agent",
    agentId: AGENT_IDS.product,
    userId: null,
    text: `The page is nearly ready. I would add the sign-up form and one line on who it is for. ${mention(AGENT_IDS.growth, "Growth Lead")}, what should the first email say?`,
    to: { agentId: AGENT_IDS.growth },
    via: null,
    createdAt: at(3, 20),
  },
  {
    id: "t4",
    seq: 4,
    speaker: "agent",
    agentId: AGENT_IDS.growth,
    userId: null,
    text: `A short welcome with one question: what are they hoping to fix? ${mention(AGENT_IDS.finance, "Finance Lead")} can tell us what a first month of ads would cost.`,
    to: { agentId: AGENT_IDS.finance },
    via: null,
    createdAt: at(3, 48),
  },
  { id: "t5", seq: 5, speaker: "founder", agentId: null, userId: "u1", text: "Keep the ads under 200 dollars for now.", to: null, via: "typed", createdAt: at(4, 10) },
  {
    id: "t6",
    seq: 6,
    speaker: "agent",
    agentId: AGENT_IDS.finance,
    userId: null,
    text: "That works. An estimate of 150 dollars covers two weeks of small tests. I will not spend anything until you say so.",
    to: "founder",
    via: null,
    createdAt: at(4, 30),
  },
];

const action = (n: number, title: string, departmentId: string | null, agentId: string | null, status: TeamCallActionView["status"], extra: Partial<TeamCallActionView> = {}): TeamCallActionView => ({
  id: `act-${n}`,
  actionType: "create_task",
  title,
  detail: null,
  departmentId,
  agentId,
  status,
  target: null,
  planId: null,
  reason: null,
  ...extra,
});

export const TEAM_CALL_SUMMARY =
  "You want to open the waitlist next week. Product adds the sign-up form to the public page, Customers writes a short welcome email, and Finance keeps the first ad test under 200 dollars.";

export const TEAM_CALL_ACTIONS: TeamCallActionView[] = [
  action(1, "Add the sign-up form to the public page", "dept-product", AGENT_IDS.product, "filed", { target: { kind: "task", id: "task-1" } }),
  action(2, "Open the waitlist on the roadmap", "dept-product", AGENT_IDS.product, "filed", { actionType: "update_roadmap", target: { kind: "roadmap_item", id: "road-1" } }),
  action(3, "Write the welcome email for the waitlist", "dept-growth", AGENT_IDS.growth, "filed", { target: { kind: "task", id: "task-2" } }),
  action(4, "Send the welcome email to the first 20 sign-ups", "dept-growth", AGENT_IDS.growth, "awaiting_go_ahead", {
    actionType: "send_message",
    planId: "plan-1",
    target: { kind: "plan", id: "plan-1" },
    reason: "Contact with people outside waits for your go-ahead.",
  }),
  action(5, "Set the first ad test budget to $150", "dept-finance", AGENT_IDS.finance, "awaiting_go_ahead", { actionType: "set_budget", planId: "plan-1", target: { kind: "plan", id: "plan-1" } }),
  action(6, "Sign the domain registrar's terms", "dept-finance", null, "founder_step", { reason: "Only you can accept terms." }),
  action(7, "Update the support macros", "dept-support", AGENT_IDS.support, "not_filed", { reason: "Support is not open to changes from calls yet." }),
];

/** A drawn stand-in for an AI face, as a data URL (no network in stories or tests). */
export function portraitDataUrl(personaKey: string): string {
  const hue = [...personaKey].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="hsl(${hue} 35% 30%)"/><circle cx="40" cy="32" r="14" fill="hsl(${hue} 40% 72%)"/><ellipse cx="40" cy="78" rx="26" ry="22" fill="hsl(${hue} 30% 48%)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Story decorator: the anthropomorphic agents provider on (persona names and faces) or off (stored names, drawn portraits). */
export const withPersonas =
  (on: boolean): Decorator =>
  (Story) => (
    <AgentPersonaProvider anthropomorphic={on} style="humans" portraitUrl={portraitDataUrl}>
      <Story />
    </AgentPersonaProvider>
  );
