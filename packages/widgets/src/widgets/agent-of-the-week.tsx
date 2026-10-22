"use client";
/**
 * Agent of the week widget: the team member with the best week (rating, recent form or value for money), with a
 * profile-card treatment (BUILD §11.9 team columns, DESIGN §8 ProfileHeader). One rating scale everywhere (founder
 * decision 2026-10-20, item 3): the /20 mean of the agent's skills with its band word, and the stars derived from it.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Award } from "lucide-react";
import type { ModelKey } from "@foundmill/shared";
import { MODEL_KEYS } from "@foundmill/shared/constants";
import { Avatar, Button, DeptChip, EntityLink, FormCells, KeyValueList, ModelChip, RATING_MAX, RatingCell, StarRating, Term, formScore, formatMoney, type FormResult } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import type { TeamAgentRow, TeamAgentsListResponse } from "../shared/types";

export const AGENT_PICKS = ["rating", "form", "value"] as const;
export const AgentOfTheWeekSettings = z.object({
  by: z.enum(AGENT_PICKS).default("rating"),
  departmentId: z.string().nullable().default(null),
});
export type AgentOfTheWeekSettings = z.infer<typeof AgentOfTheWeekSettings>;

const isModelKey = (v: unknown): v is ModelKey => typeof v === "string" && (MODEL_KEYS as readonly string[]).includes(v);

/**
 * The agent's rating on the one /20 scale: `rating20` as team.agents.list answers it (the /20 mean to one decimal);
 * else the mean of its skills' displayed values; else, for an older host, the deprecated /10 `rating` doubled. Null when
 * none is known (no training run yet).
 */
export function agentRating20(a: Pick<TeamAgentRow, "skills" | "rating"> & { rating20?: number | null }): number | null {
  if (typeof a.rating20 === "number" && Number.isFinite(a.rating20) && a.rating20 > 0) return a.rating20;
  const skills = (a.skills ?? []).map((s) => s.displayed).filter((v) => Number.isFinite(v) && v > 0);
  if (skills.length) return skills.reduce((sum, v) => sum + v, 0) / skills.length;
  return a.rating === null || a.rating === undefined || !Number.isFinite(a.rating) ? null : a.rating * 2;
}

/** The /20 rating as stars out of 5, in halves: 18/20 → 4.5. */
export function starsFromRating20(rating20: number): number {
  return Math.round((rating20 / RATING_MAX) * 10) / 2;
}

/** Score an agent for the pick: rating (/20), form (last five), or rating per dollar of wage. */
export function agentScore(a: TeamAgentRow, by: (typeof AGENT_PICKS)[number]): number {
  const rating = agentRating20(a) ?? 0;
  if (by === "form") return a.form && a.form.length ? formScore(a.form) * 2 + rating / RATING_MAX : rating;
  if (by === "value") return rating / Math.max(1, a.wage.costMinor / 100);
  return rating;
}

export function pickAgent(rows: readonly TeamAgentRow[], settings: AgentOfTheWeekSettings): TeamAgentRow | null {
  const pool = rows.filter((a) => a.status !== "paused" && (!settings.departmentId || a.departmentIds.includes(settings.departmentId)));
  if (pool.length === 0) return null;
  return pool.slice().sort((x, y) => agentScore(y, settings.by) - agentScore(x, settings.by) || x.name.localeCompare(y.name))[0] ?? null;
}

/** Rows of `team.agents.list` whichever shape the host returns (`{ agents }` from apps/api, or a bare array). */
export function agentRows(data: TeamAgentsListResponse | undefined): TeamAgentRow[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return Array.isArray(data.agents) ? data.agents : [];
}

const PICK_WORD = { rating: "Highest rating", form: "Best form", value: "Best value" } as const;

function AgentOfTheWeekWidget({ settings }: WidgetProps<AgentOfTheWeekSettings>) {
  const { businessId, navigate, currency } = useWidgetData();
  const team = useWidgetQuery<TeamAgentsListResponse>("team.agents.list", {});
  useBusinessEvents(() => team.refetch(), ["task.completed", "training.completed", "agent.promoted", "cycle.completed"]);
  const agent = useMemo(() => pickAgent(agentRows(team.data), settings), [team.data, settings]);
  const dept = agent?.departments[0];
  const rating20 = agent ? agentRating20(agent) : null;
  return (
    <WidgetFrame
      title="Agent of the week"
      data-widget="agent_of_the_week"
      queries={[team]}
      empty={team.data && !agent ? { icon: Award, text: <>The first agent of the week is named after the team's first <Term id="cycle">cycle</Term>.</> } : null}
      footer={
        <span>
          {PICK_WORD[settings.by]} · <Term id="wage">wage</Term> is an estimate of tokens, sandbox minutes and tool costs
        </span>
      }
    >
      {agent ? (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex items-start gap-3">
            <Avatar size={48} name={agent.name} agent={{ seed: agent.avatarSeed || agent.id, dept: dept?.colourToken ?? "dept-1", personaKey: agent.personaKey }} status={agent.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {/* An agent mention like any other (hover card, in-app navigation), not inert text. */}
                <EntityLink
                  entity={{ id: agent.id, kind: "agent", name: agent.name, href: routes.agent(businessId, agent.id) }}
                  onOpen={() => navigate(routes.agent(businessId, agent.id))}
                  contextMenu={false}
                  personaText="name"
                  className="t-display-md truncate text-primary"
                />
                {/* The /20 mean with its band word (the team table's cell), never a bare number. */}
                {rating20 !== null ? <RatingCell value={rating20} /> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-small text-secondary">
                <span>{agent.role}</span>
                {dept ? <DeptChip dept={dept.colourToken}>{dept.name}</DeptChip> : null}
                <ModelChip model={isModelKey(agent.modelKey) ? agent.modelKey : "sonnet"} />
              </div>
              {rating20 !== null ? <StarRating value={starsFromRating20(rating20)} showValue label="Current ability" className="mt-1" /> : null}
            </div>
          </div>
          <KeyValueList
            dense
            items={[
              { label: "Form", value: agent.form && agent.form.length ? <FormCells form={agent.form as FormResult[]} name={`${agent.name} form`} /> : "No completed tasks yet" },
              { label: "Working on", value: agent.currentTask ? agent.currentTask.title : "Between tasks" },
              { label: "Wage this month", value: <>{formatMoney({ amountMinor: agent.wage.costMinor, currency })} · <Term id="estimate" always>Estimate</Term></>, numeric: true, hint: agent.wage.capMinor ? `Cap ${formatMoney({ amountMinor: agent.wage.capMinor, currency })}` : undefined },
            ]}
          />
          <div className="mt-auto flex justify-end">
            <Button size="sm" onClick={() => navigate(routes.agent(businessId, agent.id))}>
              Open profile
            </Button>
          </div>
        </div>
      ) : null}
    </WidgetFrame>
  );
}

export const agentOfTheWeekWidget = registerWidget<AgentOfTheWeekSettings>({
  key: "agent_of_the_week",
  title: "Agent of the week",
  description: "The team member with the best week.",
  icon: "award",
  surfaces: ["home", "department"],
  // The agent, their week and the wage line above the footer.
  defaultSize: { w: 4, h: 14, minW: 3, minH: 8 },
  settingsSchema: AgentOfTheWeekSettings,
  defaultSettings: AgentOfTheWeekSettings.parse({}),
  Component: AgentOfTheWeekWidget,
});
