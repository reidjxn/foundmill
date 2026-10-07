"use client";
/**
 * Overview tab (BUILD §11.10 "Profile", DESIGN §9): "What I do", SkillGrid (Craft / Judgement / Execution, hover
 * tested/proven/n), position map derived from the template catalogue, trait chips, the Coach report in reading style,
 * the development chart (skill history with training sessions as diamonds) and the contract panel.
 */
import { useQuery } from "@tanstack/react-query";
import { BookOpenText, CalendarClock, ShieldOff } from "lucide-react";
import { useMemo } from "react";
import { Chip, DevelopmentChart, Icon, KeyValueList, Markdown, Panel, PositionMap, ProvenanceChip, SkillGrid, TraitChips, formatDateTime, formatMoney, formatRelative } from "@foundmill/dugout";
import { useTRPC } from "@/lib/trpc-react";
import type { TabProps } from "./AgentProfileScreen";
import { autonomyFromAgent, currentVersion, departmentColour, developmentSeries, humaniseKey, latestPromotedRun, negotiationFromAgent, parseInstructions, positionFits, toSkillRows, traitsFor, trainingSessionMarks, whatIDo } from "./logic";

export function OverviewTab({ businessId, profile, currency }: TabProps) {
  const trpc = useTRPC();
  const catalogueQ = useQuery(trpc.team.agents.catalogue.queryOptions({ businessId }, { staleTime: 300_000 }));
  const agent = profile.agent;
  const skills = useMemo(() => toSkillRows(profile.skills, profile.trainingRuns), [profile.skills, profile.trainingRuns]);
  const roles = useMemo(() => positionFits(agent, skills, catalogueQ.data ?? []), [agent, skills, catalogueQ.data]);
  const current = currentVersion(profile);
  const instructions = current ? parseInstructions(current.instructions) : null;
  const traits = useMemo(() => traitsFor(profile.traits, instructions), [profile.traits, instructions]);
  const series = useMemo(() => developmentSeries(skills, profile.trainingRuns), [skills, profile.trainingRuns]);
  const sessions = useMemo(() => trainingSessionMarks(profile.trainingRuns), [profile.trainingRuns]);
  const coachRun = latestPromotedRun(profile.trainingRuns) ?? profile.trainingRuns.find((r) => r.coachSummaryMd) ?? null;
  const about = whatIDo(profile);
  const autonomy = autonomyFromAgent(agent.autonomy);
  const negotiation = negotiationFromAgent(agent.negotiation);
  const schedule = (agent.schedule ?? {}) as { cron?: string; triggers?: string[] };
  const money = (minor: number | null) => (minor === null ? "No cap" : formatMoney({ amountMinor: minor, currency }));

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="agent-overview">
      <Panel title="What I do" span={8} data-testid="what-i-do">
        <div className="flex flex-col gap-3">
          {about.description ? <Markdown variant="body">{about.description}</Markdown> : <p className="text-body text-secondary">No description yet. The role line of the live instructions appears here once the agent has one.</p>}
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="t-label">Goals</dt>
              <dd>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-body text-primary">
                  {about.inputs.length ? about.inputs.slice(0, 5).map((g, i) => <li key={i}>{g}</li>) : <li className="list-none text-secondary">None recorded</li>}
                </ul>
              </dd>
            </div>
            <div>
              <dt className="t-label">How I work</dt>
              <dd>
                <ol className="mt-1 flex list-decimal flex-col gap-0.5 pl-4 text-body text-primary">
                  {about.outputs.length ? about.outputs.slice(0, 5).map((g, i) => <li key={i}>{g}</li>) : <li className="list-none text-secondary">No playbook yet</li>}
                </ol>
              </dd>
            </div>
            <div>
              <dt className="t-label flex items-center gap-1">
                <Icon icon={ShieldOff} size={12} /> Never does
              </dt>
              <dd>
                <ul className="mt-1 flex flex-col gap-0.5 text-body text-primary" data-testid="never-does">
                  {about.neverDoes.length ? about.neverDoes.map((n, i) => <li key={i}>{n}</li>) : <li className="text-secondary">Hard gates only (BUILD §2.2)</li>}
                </ul>
              </dd>
            </div>
          </dl>
        </div>
      </Panel>

      <Panel title="Traits" span={4} empty={traits.length === 0 ? { children: "Traits are derived from the instructions once a version is live." } : undefined} footer="Derived from the live instructions; hover a trait for the line it came from.">
        <TraitChips traits={traits} />
      </Panel>

      <Panel title="Skills" span={12} flush empty={skills.length === 0 ? { children: "Skills appear after the first training run. Press Train to start one." } : undefined} footer="Displayed = blend of tested and proven ratings weighted by live tasks. Hover a skill for Tested · Proven · tasks." data-testid="skills-panel">
        <div className="p-panel-pad">
          <SkillGrid skills={skills} showPotential />
        </div>
      </Panel>

      <Panel title="Position map" span={6} loading={catalogueQ.isLoading && !catalogueQ.data} empty={!catalogueQ.isLoading && roles.length === 0 ? { children: "Roles this agent could play appear once the template catalogue loads." } : undefined} footer="Fit per role from the agent's ratings over that role's skills. Estimate." data-testid="position-map">
        <PositionMap roles={roles} currentRoleId={agent.agentType} columns={2} />
      </Panel>

      <Panel title="Coach report" span={6} actions={coachRun ? <Chip tone="neutral">{formatRelative(coachRun.endedAt ?? coachRun.createdAt)}</Chip> : undefined} empty={!coachRun?.coachSummaryMd ? { icon: BookOpenText, children: "The Coach writes a report after each training run: what improved, what dropped and the instruction edits it recommends." } : undefined} data-testid="coach-report">
        {coachRun?.coachSummaryMd ? <Markdown variant="reading">{coachRun.coachSummaryMd}</Markdown> : null}
      </Panel>

      <Panel title="Development" span={8} empty={series.every((s) => s.points.length < 2) ? { children: "Skill history draws here after the first training run; sessions are marked as diamonds." } : undefined} data-testid="development-chart">
        <DevelopmentChart series={series} sessions={sessions} dept={departmentColour(profile)} width={820} height={240} aria-label={`${agent.name} development`} />
      </Panel>

      <Panel title="Contract" span={4} data-testid="contract-panel">
        <KeyValueList
          layout="rows"
          labelClassName="w-36"
          items={[
            { label: "Wage cap", value: money(agent.wageCapMinor === null ? null : Number(agent.wageCapMinor)), numeric: true },
            { label: `Spent · ${profile.wage.period}`, value: <span className="inline-flex items-center gap-1">{formatMoney({ amountMinor: profile.wage.costMinor, currency })} <ProvenanceChip kind="estimate" /></span>, numeric: true },
            { label: "Spend cap per action", value: money(autonomy.spendCapMinor), numeric: true },
            { label: "Asks above", value: money(autonomy.approvalThresholdMinor), numeric: true },
            { label: "Autonomy", value: autonomy.mode === "inherit" ? "Business mode" : autonomy.mode === "lower" ? "Asks more often" : "Acts more freely" },
            { label: "Negotiation", value: negotiation.enabled ? `On · walk-away ${money(negotiation.walkAwayMinor)}` : "Off" },
            { label: "Schedule", value: schedule.cron ? <span className="font-mono text-mono">{schedule.cron}</span> : schedule.triggers?.length ? `${schedule.triggers.length} ${schedule.triggers.length === 1 ? "trigger" : "triggers"}` : <span className="inline-flex items-center gap-1 text-secondary"><Icon icon={CalendarClock} size="inline" /> On demand</span> },
            { label: "Live version", value: current ? `v${current.version} · ${formatDateTime(current.createdAt)}` : "None", mono: true },
            { label: "Type", value: humaniseKey(agent.agentType) },
          ]}
        />
      </Panel>
    </div>
  );
}
