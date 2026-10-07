/**
 * Agent of the week widget: the squad member with the best week (rating, recent form or value for money), with a
 * player-card treatment (BUILD §11.9 squad columns, DESIGN §8 ProfileHeader).
 */
import { useMemo } from "react";
import { z } from "zod";
import { Award } from "lucide-react";
import type { ModelKey } from "@foundmill/shared";
import { MODEL_KEYS } from "@foundmill/shared";
import { Avatar, Button, DeptChip, FormCells, KeyValueList, ModelChip, RatingCell, StarRating, formScore, formatMoney, type FormResult } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import type { TeamAgentRow } from "../shared/types";

export const AGENT_PICKS = ["rating", "form", "value"] as const;
export const AgentOfTheWeekSettings = z.object({
  by: z.enum(AGENT_PICKS).default("rating"),
  departmentId: z.string().nullable().default(null),
});
export type AgentOfTheWeekSettings = z.infer<typeof AgentOfTheWeekSettings>;

const isModelKey = (v: unknown): v is ModelKey => typeof v === "string" && (MODEL_KEYS as readonly string[]).includes(v);

/** Score an agent for the pick: rating (1–10), form (last five), or rating per euro of wage. */
export function agentScore(a: TeamAgentRow, by: (typeof AGENT_PICKS)[number]): number {
  const rating = a.rating ?? 0;
  if (by === "form") return a.form && a.form.length ? formScore(a.form) * 2 + rating / 10 : rating;
  if (by === "value") return rating / Math.max(1, a.wage.costMinor / 100);
  return rating;
}

export function pickAgent(rows: readonly TeamAgentRow[], settings: AgentOfTheWeekSettings): TeamAgentRow | null {
  const pool = rows.filter((a) => a.status !== "paused" && (!settings.departmentId || a.departmentIds.includes(settings.departmentId)));
  if (pool.length === 0) return null;
  return pool.slice().sort((x, y) => agentScore(y, settings.by) - agentScore(x, settings.by) || x.name.localeCompare(y.name))[0] ?? null;
}

const PICK_WORD = { rating: "Highest rating", form: "Best form", value: "Best value" } as const;

function AgentOfTheWeekWidget({ settings }: WidgetProps<AgentOfTheWeekSettings>) {
  const { businessId, navigate } = useWidgetData();
  const team = useWidgetQuery<TeamAgentRow[]>("team.agents.list", {});
  useBusinessEvents(() => team.refetch(), ["task.completed", "training.completed", "agent.promoted", "cycle.completed"]);
  const agent = useMemo(() => pickAgent(team.data ?? [], settings), [team.data, settings]);
  const dept = agent?.departments[0];
  return (
    <WidgetFrame
      title="Agent of the week"
      data-widget="agent_of_the_week"
      queries={[team]}
      empty={team.data && !agent ? { icon: Award, text: "The first agent of the week is named after the squad's first cycle." } : null}
      footer={<span>{PICK_WORD[settings.by]} · wage is an estimate of tokens, sandbox minutes and tool costs</span>}
    >
      {agent ? (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex items-start gap-3">
            <Avatar size={48} name={agent.name} agent={{ seed: agent.avatarSeed || agent.id, dept: dept?.colourToken ?? "dept-1" }} status={agent.status} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="t-display-md truncate text-primary">{agent.name}</span>
                {agent.rating !== null ? <RatingCell value={agent.rating} /> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-small text-secondary">
                <span>{agent.role}</span>
                {dept ? <DeptChip dept={dept.colourToken}>{dept.name}</DeptChip> : null}
                <ModelChip model={isModelKey(agent.modelKey) ? agent.modelKey : "sonnet"} />
              </div>
              {agent.rating !== null ? <StarRating value={Math.round(agent.rating) / 2} showValue label="Current ability" className="mt-1" /> : null}
            </div>
          </div>
          <KeyValueList
            dense
            items={[
              { label: "Form", value: agent.form && agent.form.length ? <FormCells form={agent.form as FormResult[]} name={`${agent.name} form`} /> : "No completed tasks yet" },
              { label: "Working on", value: agent.currentTask ? agent.currentTask.title : "Between tasks" },
              { label: "Wage this month", value: `${formatMoney({ amountMinor: agent.wage.costMinor, currency: "EUR" })} · Estimate`, numeric: true, hint: agent.wage.capMinor ? `Cap ${formatMoney({ amountMinor: agent.wage.capMinor, currency: "EUR" })}` : undefined },
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
  description: "The squad member with the best week.",
  icon: "award",
  surfaces: ["home", "department"],
  defaultSize: { w: 4, h: 10, minW: 3, minH: 8 },
  settingsSchema: AgentOfTheWeekSettings,
  defaultSettings: AgentOfTheWeekSettings.parse({}),
  Component: AgentOfTheWeekWidget,
});
