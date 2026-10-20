"use client";
/**
 * Overview tab (BUILD §11.10 "Profile", DESIGN §9): "What I do", SkillGrid (Craft / Judgment / Execution, each figure
 * with its band word, hover tested/proven/n), the other roles the agent could take (derived from the template
 * catalogue), trait chips, the Coach report in reading style, the development chart (skill history with training
 * sessions as diamonds) and the contract panel. The version and type live on the History tab.
 */
import { useQuery } from "@tanstack/react-query";
import { BookOpenText, CalendarClock, ShieldOff } from "lucide-react";
import { useMemo } from "react";
import { effectiveApprovalThresholdMinor } from "@foundmill/config";
import { Chip, DevelopmentChart, Icon, KeyValueList, Markdown, POSITION_MAP_BASIS, POSITION_MAP_TITLE, Panel, PositionMap, ProvenanceChip, RATING_MAX, SKILL_GRID_WHY, SkillGrid, Term, TraitChips, formatMoney, formatRelative, useFormatters, useGuided, type TermDefinition } from "@foundmill/dugout";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import type { TabProps } from "./AgentProfileScreen";
import { autonomyFromAgent, currentVersion, departmentColour, developmentSeries, latestPromotedRun, parseInstructions, positionFits, toSkillRows, traitsFor, trainingSessionMarks, wageLabel, whatIDo } from "./logic";

/**
 * "Tested" and "Proven" defined where the founder meets them (UX plan §7.15 C3). Inline definitions until the
 * definitions map (packages/shared/src/terms.ts) carries `tested` and `proven`; the ids are the ones it will use.
 */
export const SKILL_SCORE_TERMS: Record<"tested" | "proven", TermDefinition> = {
  tested: { id: "tested", word: "Tested", short: "The score on practice tests: what the agent does on held-back examples, 1 to 20.", long: "Half of the practice tests stay hidden so the score stays honest. A training run re-tests every skill and the Coach compares the results with the live version.", learn: "team/agents" },
  proven: { id: "proven", word: "Proven", short: "The score on real work: how the agent's finished tasks went, 1 to 20.", long: "More real work makes Proven count for more in the displayed score; a new skill shows its tested score alone until the agent has used it.", learn: "team/agents" },
};

/** What the Skills panel is about, for its "About Skills" tip (InfoTip through Panel `help`; hidden with guidance off). */
export const SKILLS_HELP = `Each skill is scored 1–${RATING_MAX} and always shows its band word: Poor, Average, Good or Excellent. Training can move it.`;

/** The Skills panel footer (UX plan §7.15 C3): what the scores are, with Tested and Proven as defined words, and why they matter while guided. */
export function SkillsFooter({ guided }: { guided: boolean }) {
  return (
    <span data-testid="skills-footer">
      Scores 1–{RATING_MAX}. <Term id="tested" definition={SKILL_SCORE_TERMS.tested}>Tested</Term> is the result on practice tests, <Term id="proven" definition={SKILL_SCORE_TERMS.proven}>Proven</Term> the result on real work; more real work makes Proven count for more. Hover a skill for its tested and proven scores.
      {guided ? <span data-testid="skills-why"> {SKILL_GRID_WHY}</span> : null}
    </span>
  );
}

export function OverviewTab({ businessId, profile, currency }: TabProps) {
  const { prefs: datePrefs } = useFormatters();
  const guided = useGuided();
  const business = useBusiness();
  const businessCurrency = useBusinessCurrency();
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
  const schedule = (agent.schedule ?? {}) as { cron?: string; triggers?: string[] };
  const money = (minor: number | null) => (minor === null ? "No cap" : formatMoney({ amountMinor: minor, currency }));
  // The founder's "Spend cap per action" (Settings › Mode) lowers every agent's ask line, as the gateway applies it.
  const businessCapMinor = business.data.business.spendCapMinor;
  const capBinds = businessCapMinor !== null && effectiveApprovalThresholdMinor(autonomy.approvalThresholdMinor, businessCapMinor) === businessCapMinor && businessCapMinor !== autonomy.approvalThresholdMinor;
  const asksAbove = capBinds ? (
    <span className="inline-flex items-center gap-1.5" data-testid="asks-above-business-cap">
      {formatMoney({ amountMinor: businessCapMinor, currency: businessCurrency })} <span className="text-small text-secondary">business cap</span>
    </span>
  ) : (
    money(autonomy.approvalThresholdMinor)
  );

  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="agent-overview">
      <Panel title="What I do" span={8} data-testid="what-i-do">
        <div className="flex flex-col gap-3">
          {about.description ? <Markdown variant="body">{about.description}</Markdown> : <p className="text-body text-secondary">No description yet. The role line of the live instructions appears here once the agent has one.</p>}
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="t-label">What I aim for</dt>
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
                  {about.neverDoes.length ? about.neverDoes.map((n, i) => <li key={i}>{n}</li>) : <li className="text-secondary">Anything that moves money, signs or accepts terms in your name</li>}
                </ul>
              </dd>
            </div>
          </dl>
        </div>
      </Panel>

      <Panel title="Traits" span={4} className="self-start" empty={traits.length === 0 ? { children: "Traits are derived from the instructions once a version is live." } : undefined} footer="Derived from the live instructions; hover a trait for the line it came from.">
        <TraitChips traits={traits} />
      </Panel>

      <Panel
        title="Skills"
        help={SKILLS_HELP}
        helpLearn="team/agents"
        span={12}
        flush
        empty={skills.length === 0 ? { children: "Skills appear after the first training run. Press Train to start one." } : undefined}
        footer={<SkillsFooter guided={guided} />}
        data-testid="skills-panel"
      >
        <div className="p-panel-pad">
          <SkillGrid skills={skills} showPotential />
        </div>
      </Panel>

      <Panel title={<Term id="position_map">{POSITION_MAP_TITLE}</Term>} span={6} loading={catalogueQ.isLoading && !catalogueQ.data} empty={!catalogueQ.isLoading && roles.length === 0 ? { children: "The roles this agent could take appear once the template catalog loads." } : undefined} footer={POSITION_MAP_BASIS} data-testid="position-map">
        <PositionMap roles={roles} currentRoleId={agent.agentType} columns={2} />
      </Panel>

      <Panel
        title={
          <>
            <Term id="coach">Coach</Term> report
          </>
        }
        span={6}
        actions={coachRun ? <Chip tone="neutral">{formatRelative(coachRun.endedAt ?? coachRun.createdAt)}</Chip> : undefined}
        empty={!coachRun?.coachSummaryMd ? { icon: BookOpenText, children: "The Coach writes a report after each training run: what improved, what dropped and the instruction edits it recommends." } : undefined}
        data-testid="coach-report"
      >
        {coachRun?.coachSummaryMd ? <Markdown variant="reading">{coachRun.coachSummaryMd}</Markdown> : null}
      </Panel>

      <Panel title="Development" span={8} empty={series.every((s) => s.points.length < 2) ? { children: "Skill history draws here after the first training run; sessions are marked as diamonds." } : undefined} data-testid="development-chart">
        <DevelopmentChart series={series} sessions={sessions} dept={departmentColour(profile)} width={820} height={240} aria-label={`${agent.name} development`} datePrefs={datePrefs} />
      </Panel>

      {/* Negotiation has no runtime yet (AC-11.14.3): nothing about it until it ships, except the one line in the footer (C12). */}
      <Panel title="Contract" span={4} footer={<span data-testid="negotiation-note">Negotiation arrives with LIVE deals.</span>} data-testid="contract-panel">
        <KeyValueList
          layout="rows"
          labelClassName="w-36"
          items={[
            // A wage cap caps the agent's metered cost, so it is in US dollars like that cost (`profile.wage.currency`).
            { label: <Term id="wage_cap">Wage cap (USD)</Term>, value: agent.wageCapMinor === null ? "No cap" : formatMoney({ amountMinor: Number(agent.wageCapMinor), currency: profile.wage.currency }), numeric: true },
            { label: wageLabel(profile.wage.period, undefined, datePrefs).replace(/^AI cost/, "Spent"), value: <span className="inline-flex items-center gap-1">{formatMoney({ amountMinor: profile.wage.costMinor, currency: profile.wage.currency })} <ProvenanceChip kind="estimate" /></span>, numeric: true },
            { label: "Spend cap per action", value: money(autonomy.spendCapMinor), numeric: true },
            { label: "Needs your OK above", value: asksAbove, numeric: true },
            { label: <Term id="autonomy">Autonomy</Term>, value: autonomy.mode === "inherit" ? "Business mode" : autonomy.mode === "lower" ? "Asks more often" : "Acts more freely" },
            { label: "Schedule", value: schedule.cron ? <span className="font-mono text-mono">{schedule.cron}</span> : schedule.triggers?.length ? `${schedule.triggers.length} ${schedule.triggers.length === 1 ? "trigger" : "triggers"}` : <span className="inline-flex items-center gap-1 text-secondary"><Icon icon={CalendarClock} size="inline" /> On demand</span> },
          ]}
        />
      </Panel>
    </div>
  );
}
