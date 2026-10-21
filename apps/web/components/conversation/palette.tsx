/**
 * The command palette's lead rows (DIRECTION: Ask and Generate first): "Ask <agent>" opens that agent's desk as a
 * sheet, carrying whatever the founder typed as the first message; "Generate…" rows go to the surfaces where a real
 * model call drafts something (logos, a task graph, a channel recommendation), next to the control that starts it.
 */
import type { ReactNode } from "react";
import type { PaletteItem } from "@foundmill/dugout";
import type { DeptColourToken } from "@foundmill/shared";
import { MODULE_TABS, type ModuleKey } from "@foundmill/shared/constants";
import { routes } from "@foundmill/widgets/shared/routes";

export interface PaletteAgent {
  id: string;
  name: string;
  role: string | null;
  avatarSeed: string;
  dept: DeptColourToken;
  departmentName: string;
  lead: boolean;
}

interface DepartmentForPalette {
  id: string;
  name: string;
  slug: string;
  colourToken: string;
  hidden?: boolean;
  moduleKeys: readonly string[];
  lead?: { id: string; name: string; role: string | null; avatarSeed: string | null } | null;
  squad: readonly { id: string; name: string; role: string | null; avatarSeed: string | null }[];
  tabs: readonly { slug: string; position: number; title?: string }[];
}

/** Every agent of the visible departments once, leads first. */
export function paletteAgents(departments: readonly DepartmentForPalette[]): PaletteAgent[] {
  const out = new Map<string, PaletteAgent>();
  const visible = departments.filter((d) => !d.hidden);
  for (const d of visible) {
    if (d.lead && !out.has(d.lead.id)) out.set(d.lead.id, { id: d.lead.id, name: d.lead.name, role: d.lead.role, avatarSeed: d.lead.avatarSeed || d.lead.id, dept: d.colourToken as DeptColourToken, departmentName: d.name, lead: true });
  }
  for (const d of visible) {
    for (const a of d.squad) if (!out.has(a.id)) out.set(a.id, { id: a.id, name: a.name, role: a.role, avatarSeed: a.avatarSeed || a.id, dept: d.colourToken as DeptColourToken, departmentName: d.name, lead: false });
  }
  return [...out.values()];
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/**
 * The Ask rows for the query: agents whose name or role the query mentions ("juno", "chemist"), else the department
 * leads; at most `max`, so the rows that lead the palette never crowd out the results.
 */
export function askPaletteItems(agents: readonly PaletteAgent[], text: string, avatar: (a: PaletteAgent) => ReactNode, max = 3): PaletteItem[] {
  const q = words(text);
  const matched = q.length ? agents.filter((a) => q.some((w) => words(`${a.name} ${a.role ?? ""}`).some((x) => x.startsWith(w)))) : [];
  const pick = (matched.length ? matched : agents.filter((a) => a.lead)).slice(0, max);
  return pick.map((a) => ({
    id: `ask:${a.id}`,
    kind: "ask" as const,
    label: `Ask ${a.name}`,
    description: [a.role && a.role !== a.name ? a.role : null, a.departmentName].filter(Boolean).join(" · "),
    keywords: [a.name, a.role ?? "", a.departmentName, "ask", "talk"],
    avatar: avatar(a),
    dept: a.dept,
  }));
}

/**
 * The question the palette carries to the agent: the typed words without the ones that only picked the agent
 * ("ask juno why is cash down?" → "Why is cash down?"); empty when nothing else was typed.
 */
export function askQuestion(text: string, agent: Pick<PaletteAgent, "name" | "role">): string {
  const picks = words(`${agent.name} ${agent.role ?? ""}`);
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length) {
    const w = tokens[i]!.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (w === "ask" || w === "to" || (w.length >= 3 && picks.some((p) => p.startsWith(w)))) i++;
    else break;
  }
  const rest = tokens.slice(i).join(" ");
  if (!rest) return "";
  const sentence = rest[0]!.toUpperCase() + rest.slice(1);
  // "why is cash down" reads as the question it is ("Why is cash down?"); anything already punctuated stays as typed.
  return /[.!?…]$/.test(sentence) || !QUESTION_START.test(sentence) ? sentence : `${sentence}?`;
}

const QUESTION_START = /^(why|what|how|when|where|who|which|is|are|was|were|can|could|should|would|will|do|does|did|have|has|any)\b/i;

/** The agent behind an Ask row. */
export function agentOfAskItem(item: Pick<PaletteItem, "id">, agents: readonly PaletteAgent[]): PaletteAgent | null {
  return item.id.startsWith("ask:") ? (agents.find((a) => a.id === item.id.slice(4)) ?? null) : null;
}

/**
 * A module tab as the founder named it: the href and "<department> › <tab>" from the department that owns the module
 * ("Retail Partnerships › Board" once Distribution is renamed), never a hard-coded department name.
 */
function moduleTab(businessId: string, departments: readonly DepartmentForPalette[], moduleKey: ModuleKey, tabSlug: string): { href: string; where: string } | null {
  const d = departments.find((x) => !x.hidden && x.moduleKeys.includes(moduleKey));
  if (!d) return null;
  const tab = d.tabs.find((t) => t.slug === tabSlug);
  if (!tab) return null;
  const title = tab.title ?? MODULE_TABS[moduleKey].find((t) => t.slug === tabSlug)?.title ?? tabSlug;
  return { href: routes.department(businessId, d.slug, tab.slug), where: `${d.name} › ${title}` };
}

/** The Generate rows: where a real model call drafts something, each opening the surface with its generate control. */
export function generatePaletteItems(businessId: string, departments: readonly DepartmentForPalette[]): PaletteItem[] {
  const rows: PaletteItem[] = [{ id: "generate:logos", kind: "generate", label: "Generate logos", description: "Four marks from the logo designer · Settings › Business", keywords: ["logo", "mark", "brand", "draft"], href: routes.settings(businessId, "business") }];
  const plan = moduleTab(businessId, departments, "development", "plan");
  if (plan) rows.push({ id: "generate:task-graph", kind: "generate", label: "Plan the tasks for a goal", description: `The Planner breaks a roadmap item or a goal into tasks · ${plan.where}`, keywords: ["plan", "tasks", "planner", "draft"], href: plan.href });
  const board = moduleTab(businessId, departments, "distribution", "formation");
  if (board) rows.push({ id: "generate:channels", kind: "generate", label: "Recommend channels", description: `Scores every channel for this business · ${board.where}`, keywords: ["channels", "distribution", "recommend", "board"], href: board.href });
  return rows;
}
