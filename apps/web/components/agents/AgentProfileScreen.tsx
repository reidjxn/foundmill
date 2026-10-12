"use client";
/**
 * Agent profile (BUILD §11.10, DESIGN §9 "Agent profile"): ProfileHeader (avatar, name, role, departments, line
 * manager, model chip, status, wage, current/potential stars; "Talk to <agent>" opens the agent's desk as a sheet,
 * where "Take a break" pauses its running task through `dev.tasks.pause`) above the six tabs overview | training | autonomy |
 * tools | history | logs. The model chip anywhere on the screen opens ModelChangeDialog → ApplyScopeDialog →
 * `agent.model.set`. Data comes from `agent.profile.get`, polled every 5 s while a training run is active.
 */
import { useQuery } from "@tanstack/react-query";
import { Dumbbell, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Avatar, Button, EntityLink, HealthBadge, ModelChip, ProfileHeader, formatMoney, useDateFormat, type ProfileChip, type ProfileFact, type TabItem } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { ErrorPanel } from "@/components/shell/ErrorPanel";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { useAgentDesk } from "@/components/conversation/DeskHost";
import { AutonomyTab } from "./AutonomyTab";
import { HistoryTab } from "./HistoryTab";
import { LogsTab } from "./LogsTab";
import { ModelChangeDialog } from "./ModelChangeDialog";
import { OverviewTab } from "./OverviewTab";
import { ToolsTab } from "./ToolsTab";
import { TrainingTab } from "./TrainingTab";
import { AGENT_TABS, departmentColour, humaniseKey, meanRating, profileChips, starsFor, toSkillRows, trainingFlow, wageLabel, type AgentProfile, type AgentTab } from "./logic";

export interface AgentProfileScreenProps {
  agentId: string;
  tab: AgentTab;
}

/** Shared by every tab: the profile, the business and the open-model-dialog callback. */
export interface TabProps {
  businessId: string;
  profile: AgentProfile;
  currency: string;
  onChangeModel: () => void;
  refetch: () => void;
}

export function AgentProfileScreen({ agentId, tab }: AgentProfileScreenProps) {
  const datePrefs = useDateFormat();
  const { businessId, data, departments } = useBusiness();
  const trpc = useTRPC();
  const router = useRouter();
  const [modelOpen, setModelOpen] = useState(false);
  const currency = data.business.glossary?.currency ?? "EUR";
  const desk = useAgentDesk();

  const profileQ = useQuery(
    trpc.agent.profile.get.queryOptions(
      { businessId, agentId },
      {
        staleTime: 10_000,
        refetchInterval: (q) => {
          const runs = q.state.data?.trainingRuns;
          return runs && trainingFlow(runs).phase === "active" ? 5_000 : false;
        },
      },
    ),
  );
  const squadQ = useQuery(trpc.team.agents.list.queryOptions({ businessId }, { staleTime: 60_000, enabled: modelOpen || tab === "autonomy" }));
  const profile = profileQ.data;

  const tabs = useMemo<TabItem[]>(() => AGENT_TABS.map((t) => ({ id: t.id, label: t.label, href: routes.agent(businessId, agentId, t.id) })), [businessId, agentId]);
  const teamDept = useMemo(() => departments.find((d) => d.moduleKeys.includes("team")), [departments]);
  const squadHref = teamDept ? routes.department(businessId, teamDept.slug, teamDept.tabs.slice().sort((a, b) => a.position - b.position)[0]?.slug ?? "squad") : undefined;

  useShellChrome(
    {
      title: profile?.agent.name ?? "Agent",
      tabs: { tabs, activeId: tab, onChange: (id) => router.push(routes.agent(businessId, agentId, id)), "aria-label": "Agent profile tabs" },
      breadcrumbs: [{ label: "Agents", href: squadHref }, { label: profile?.agent.name ?? "Agent" }],
    },
    [profile?.agent.name, tabs, tab, squadHref],
  );

  if (profileQ.error) return <ErrorPanel title="Agent profile" message={errorMessage(profileQ.error)} onRetry={() => void profileQ.refetch()} />;
  if (!profile) return <ScreenSkeleton />;

  const agent = profile.agent;
  const dept = departmentColour(profile);
  const skillRows = toSkillRows(profile.skills, profile.trainingRuns);
  const mean = meanRating(skillRows);
  const potential = meanRating(skillRows.map((s) => ({ value: s.potential ?? s.value })));
  // Each chip once: a Chief of Staff's role and layer are the same words.
  const chips: ProfileChip[] = profileChips(agent, profile.departments);
  const facts: ProfileFact[] = [
    {
      label: "Line manager",
      value: profile.lineManager ? <EntityLink entity={{ id: profile.lineManager.id, kind: "agent", name: profile.lineManager.name, href: routes.agent(businessId, profile.lineManager.id) }} hoverCard={false} contextMenu={false} /> : <span className="text-secondary">You</span>,
    },
    { label: wageLabel(profile.wage.period, undefined, datePrefs), value: `${formatMoney({ amountMinor: profile.wage.costMinor, currency: profile.wage.currency })}${profile.wage.wageCapMinor !== null ? ` of ${formatMoney({ amountMinor: profile.wage.wageCapMinor, currency: profile.wage.currency })}` : ""}`, provenance: "estimate" },
    { label: "Tasks · 30 days", value: profile.metrics.reduce((s, m) => s + m.tasksDone, 0) },
  ];
  const typeCount = squadQ.data?.agents.filter((a) => a.agentType === agent.agentType).length;
  const allCount = squadQ.data?.agents.length;
  const tabProps: TabProps = { businessId, profile, currency: agent.currency ?? currency, onChangeModel: () => setModelOpen(true), refetch: () => void profileQ.refetch() };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="agent-profile" data-agent-id={agent.id} data-tab={tab}>
      <ProfileHeader
        avatar={<Avatar size={64} name={agent.name} agent={{ seed: agent.avatarSeed || agent.id, dept }} status={agent.status} />}
        name={agent.name}
        chips={chips}
        status={<HealthBadge status={agent.status} />}
        facts={facts}
        stars={mean !== null ? { current: starsFor(mean) ?? 0, potential: starsFor(potential) } : undefined}
        actions={
          <>
            {/* The model chip is the control (it opens the model dialog); its tooltip says so, no "Click to change" label. */}
            <span data-testid="header-model-chip" className="inline-flex" title={profile.modelLock ? "This agent's model is fixed" : "Change the model"}>
              <ModelChip model={agent.modelKey} locked={profile.modelLock} onClick={() => setModelOpen(true)} />
            </span>
            <Button size="sm" icon={Dumbbell} onClick={() => router.push(routes.agent(businessId, agent.id, "training"))} data-testid="header-train">
              Train
            </Button>
            {desk ? (
              <Button
                size="sm"
                variant="primary"
                icon={MessageCircle}
                onClick={() => desk.open({ kind: "agent", id: agent.id }, { persona: { name: agent.name, role: agent.role || humaniseKey(agent.agentType), avatarSeed: agent.avatarSeed || agent.id, dept } })}
                // The sheet's code is on its way before the press.
                onPointerEnter={desk.prefetch}
                onFocus={desk.prefetch}
                aria-haspopup="dialog"
                data-testid="header-talk"
              >
                Talk to {agent.name}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "overview" ? <OverviewTab {...tabProps} /> : null}
        {tab === "training" ? <TrainingTab {...tabProps} /> : null}
        {tab === "autonomy" ? <AutonomyTab {...tabProps} typeCount={typeCount} allCount={allCount} /> : null}
        {tab === "tools" ? <ToolsTab {...tabProps} /> : null}
        {tab === "history" ? <HistoryTab {...tabProps} /> : null}
        {tab === "logs" ? <LogsTab {...tabProps} /> : null}
      </div>
      <ModelChangeDialog businessId={businessId} profile={profile} open={modelOpen} onOpenChange={setModelOpen} typeCount={typeCount} allCount={allCount} />
    </div>
  );
}
