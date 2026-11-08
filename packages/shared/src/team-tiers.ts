/**
 * Leads first (founder, 2026-11-08): every agent sits in one of four tiers, worked out from what is already stored
 * (`agents.layer`, `agents.agent_type`, `agents.line_manager_id` and `departments.lead_agent_id`), so no migration and
 * no new column.
 *
 * - `chief`: the business's Chief of Staff (the assistant layer).
 * - `lead`: a department's lead (`departments.lead_agent_id`), or an agent on the lead layer.
 * - `specialist`: everyone else who takes tasks. The Planner is a specialist: it takes coding and research tasks.
 * - `background`: the five utility templates (entity linker, classifier, categorizer, inbound sorter, moderation).
 *   They never take tasks or write to the founder, always read by their role name, and stay out of the founder's lists
 *   and counts. The entity resolver keeps them, so an old mention of one still resolves.
 *
 * `teamTree` also owns the reporting line the Hierarchy draws (it moved here from the Hierarchy screen): an explicit
 * line manager that is a live, visible agent; else a specialist's first department's lead; else the Chief of Staff;
 * the Chief of Staff reports to the founder (`null`).
 */
import { isBackgroundHelper } from "./personas";

export const AGENT_TIERS = ["chief", "lead", "specialist", "background"] as const;
export type AgentTier = (typeof AGENT_TIERS)[number];

/** The agent facts the tier rules read. Every field but `id` is optional, so API rows, roster rows and seeds all fit. */
export interface TierAgent {
  id: string;
  layer?: string | null;
  agentType?: string | null;
  lineManagerId?: string | null;
  departmentIds?: readonly string[] | null;
  /** The departments as the API sends them (`team.agents.list`), when there are no `departmentIds`. */
  departments?: readonly { id: string }[] | null;
  /** `team.agents.list` marks the one designated Chief of Staff; absent on older payloads. */
  chiefOfStaff?: boolean | null;
  archivedAt?: unknown;
  /** The tier the API already worked out (`team.agents.list`, `department.list`): trusted when present. */
  tier?: AgentTier | null;
}

/** The department facts the tier rules read. */
export interface TierDepartment {
  id: string;
  leadAgentId?: string | null;
  position?: number | null;
  hidden?: boolean | null;
}

/** The ids of the agents that lead a department. */
export function leadAgentIds(departments: readonly TierDepartment[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const d of departments ?? []) if (d.leadAgentId) out.add(d.leadAgentId);
  return out;
}

function isChief(agent: TierAgent): boolean {
  if (typeof agent.chiefOfStaff === "boolean") return agent.chiefOfStaff;
  return agent.layer === "assistant" || agent.agentType === "chief_of_staff";
}

/**
 * The agent's tier. The Chief of Staff first, then the background helpers (a helper never leads, even when set as a
 * department's lead), then leads (a department's lead, the lead layer, or a `*_lead` template), else a specialist.
 * `leads` is the set of department lead ids (`leadAgentIds`) or the departments themselves.
 */
export function agentTier(agent: TierAgent, leads?: ReadonlySet<string> | readonly TierDepartment[] | null): AgentTier {
  if (agent.tier && (AGENT_TIERS as readonly string[]).includes(agent.tier)) return agent.tier;
  if (isChief(agent)) return "chief";
  if (isBackgroundHelper(agent)) return "background";
  const leadIds = leads instanceof Set ? leads : leadAgentIds(leads as readonly TierDepartment[] | null | undefined);
  if (leadIds.has(agent.id) || agent.layer === "lead" || agent.layer === "assistant" || (agent.agentType ?? "").endsWith("_lead")) return "lead";
  return "specialist";
}

/** True for a background helper, by its stored tier when the row has one, else by its layer and template. */
export function isBackgroundAgent(agent: Pick<TierAgent, "tier" | "layer" | "agentType">): boolean {
  if (agent.tier) return agent.tier === "background";
  return isBackgroundHelper(agent);
}

/** The agents a founder's list or count shows: everyone but the background helpers. */
export function founderVisible<A extends Pick<TierAgent, "tier" | "layer" | "agentType">>(agents: readonly A[]): A[] {
  return agents.filter((a) => !isBackgroundAgent(a));
}

/** One lead (or the Chief of Staff) with the specialists who report to it, for the Agents tab. */
export interface TeamTreeGroup<A> {
  agent: A;
  tier: AgentTier;
  specialists: A[];
}

export interface TeamTree<A> {
  /** The Chief of Staff, or null before one is hired. */
  chief: A | null;
  /**
   * The Agents tab's top level: the Chief of Staff first, then the leads in department order (a lead of several
   * departments at its first), then leads of no department; each with its specialists (the agents whose reporting
   * line reaches it first). A specialist whose line reaches neither (no lead, no Chief of Staff) is its own group.
   */
  groups: TeamTreeGroup<A>[];
  /** Live leads and Chief of Staff and specialists, in the `groups` order (Chief of Staff, each lead, its specialists). */
  visible: A[];
  /** The live background helpers, in input order. */
  background: A[];
  /** Every live agent's tier. */
  tierOf: Map<string, AgentTier>;
  /** The Hierarchy's reporting line for every live, visible agent: an agent id, or null for the founder. */
  parentOf: Map<string, string | null>;
  /** The group head (Chief of Staff or lead) each specialist sits under in `groups`. */
  groupOf: Map<string, string>;
  counts: Record<AgentTier, number>;
}

function departmentIdsOf(agent: TierAgent): readonly string[] {
  if (agent.departmentIds && agent.departmentIds.length) return agent.departmentIds;
  return (agent.departments ?? []).map((d) => d.id);
}

/**
 * The team as the founder reads it: tiers, the reporting line and the Agents tab's groups. Archived agents are left
 * out. Background helpers are never anyone's parent, so a line manager that is a helper falls back to the default line.
 */
export function teamTree<A extends TierAgent>(agents: readonly A[], departments?: readonly TierDepartment[] | null): TeamTree<A> {
  const live = agents.filter((a) => !a.archivedAt);
  const leads = leadAgentIds(departments);
  const tierOf = new Map<string, AgentTier>();
  for (const a of live) tierOf.set(a.id, agentTier(a, leads));
  const visibleAgents = live.filter((a) => tierOf.get(a.id) !== "background");
  const visibleIds = new Set(visibleAgents.map((a) => a.id));
  const byId = new Map(visibleAgents.map((a) => [a.id, a] as const));
  const chief = visibleAgents.find((a) => tierOf.get(a.id) === "chief") ?? null;

  // Departments in sidebar order; each department's lead when it is a live, visible agent.
  const ordered = [...(departments ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const leadOfDept = new Map<string, string>();
  for (const d of ordered) if (d.leadAgentId && visibleIds.has(d.leadAgentId)) leadOfDept.set(d.id, d.leadAgentId);

  const parentOf = new Map<string, string | null>();
  for (const a of visibleAgents) {
    const tier = tierOf.get(a.id)!;
    const explicit = a.lineManagerId && a.lineManagerId !== a.id && visibleIds.has(a.lineManagerId) ? a.lineManagerId : null;
    let parent: string | null = explicit;
    if (!parent) {
      if (tier === "chief") parent = null;
      else if (tier === "specialist") {
        const deptId = departmentIdsOf(a)[0];
        const lead = deptId ? leadOfDept.get(deptId) : undefined;
        parent = lead && lead !== a.id ? lead : (chief && chief.id !== a.id ? chief.id : null);
      } else parent = chief && chief.id !== a.id ? chief.id : null;
    }
    parentOf.set(a.id, parent);
  }

  // Group heads: the Chief of Staff, then leads in department order, then leads of no department (input order).
  const heads: A[] = [];
  const seen = new Set<string>();
  const pushHead = (a: A | null | undefined) => {
    if (!a || seen.has(a.id)) return;
    seen.add(a.id);
    heads.push(a);
  };
  pushHead(chief);
  for (const d of ordered) {
    const id = leadOfDept.get(d.id);
    if (id && tierOf.get(id) === "lead") pushHead(byId.get(id));
  }
  for (const a of visibleAgents) if (tierOf.get(a.id) === "lead") pushHead(a);
  const headIds = new Set(heads.map((h) => h.id));

  // A specialist sits under the first head its reporting line reaches (a specialist managed by a specialist goes with
  // that one's lead). A cycle or a line that ends at the founder makes it its own group.
  const groupOf = new Map<string, string>();
  const loose: A[] = [];
  const members = new Map<string, A[]>(heads.map((h) => [h.id, []]));
  for (const a of visibleAgents) {
    if (headIds.has(a.id)) continue;
    const visited = new Set<string>([a.id]);
    let cursor = parentOf.get(a.id) ?? null;
    while (cursor && !headIds.has(cursor) && !visited.has(cursor)) {
      visited.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
    if (cursor && headIds.has(cursor)) {
      groupOf.set(a.id, cursor);
      members.get(cursor)!.push(a);
    } else loose.push(a);
  }

  const groups: TeamTreeGroup<A>[] = [
    ...heads.map((h) => ({ agent: h, tier: tierOf.get(h.id)!, specialists: members.get(h.id) ?? [] })),
    ...loose.map((a) => ({ agent: a, tier: tierOf.get(a.id)!, specialists: [] })),
  ];
  const counts: Record<AgentTier, number> = { chief: 0, lead: 0, specialist: 0, background: 0 };
  for (const t of tierOf.values()) counts[t] += 1;
  return {
    chief,
    groups,
    visible: groups.flatMap((g) => [g.agent, ...g.specialists]),
    background: live.filter((a) => tierOf.get(a.id) === "background"),
    tierOf,
    parentOf,
    groupOf,
    counts,
  };
}

/**
 * The Agents tab's caption: "Chief of Staff · 6 leads · 23 specialists · 2 need you". The Chief of Staff is named, not
 * counted as a lead, so the parts add up to the rows the founder sees; "need you" (failing, down or degraded) only when
 * any do. Background helpers are not in it.
 */
export function teamCaption(counts: Pick<Record<AgentTier, number>, "chief" | "lead" | "specialist">, needYou = 0): string {
  const parts: string[] = [];
  if (counts.chief > 0) parts.push(counts.chief === 1 ? "Chief of Staff" : `${counts.chief} Chiefs of Staff`);
  parts.push(`${counts.lead} ${counts.lead === 1 ? "lead" : "leads"}`);
  parts.push(`${counts.specialist} ${counts.specialist === 1 ? "specialist" : "specialists"}`);
  if (needYou > 0) parts.push(`${needYou} ${needYou === 1 ? "needs" : "need"} you`);
  return parts.join(" · ");
}

/** What the background helpers do, in one honest line for the founder ("5 background helpers also run, …"). */
export function backgroundHelpersLine(count: number): string {
  const who = count === 1 ? "1 background helper also runs" : `${count} background helpers also run`;
  return `${who}, linking names, sorting what comes in and checking drafts. They never take tasks or write to you.`;
}
