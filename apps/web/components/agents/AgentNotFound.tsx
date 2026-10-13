"use client";
/**
 * /b/[bid]/agents/<id>/<tab> when the id is not an agent id or the tab is not a profile tab (audit IAE-15): the miss is
 * the agent or the tab, inside a business the founder can see, so it says which and links back, instead of the
 * business-level "No business at this address".
 */
import { ArrowRight, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { EmptyState, Panel } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { AGENT_TABS } from "./tabs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function AgentNotFound() {
  const { businessId, departments } = useBusiness();
  const router = useRouter();
  const params = useParams<{ agentId?: string; tab?: string }>();
  const agentId = decodeURIComponent(params?.agentId ?? "");
  const tab = decodeURIComponent(params?.tab ?? "");
  const teamDept = departments.find((d) => d.moduleKeys.includes("team"));
  const agentsHref = teamDept ? routes.department(businessId, teamDept.slug, teamDept.tabs.slice().sort((a, b) => a.position - b.position)[0]?.slug ?? "squad") : routes.home(businessId);
  const badAgent = !UUID_RE.test(agentId);
  useShellChrome({ title: badAgent ? "Agent" : "Agent profile", breadcrumbs: [{ label: "Agents", href: teamDept ? agentsHref : undefined }, { label: "Not found" }] }, [agentsHref, badAgent]);
  return (
    <div className="p-gutter" data-testid="agent-not-found">
      <Panel title="Agent" span={12}>
        {badAgent ? (
          <EmptyState icon={Users} title="No such agent" action={{ label: teamDept ? "Open Agents" : "Go to Home", icon: ArrowRight, onClick: () => router.push(agentsHref) }}>
            There is no agent at this address in this business.
          </EmptyState>
        ) : (
          <EmptyState icon={Users} title="No such tab" action={{ label: "Open Overview", icon: ArrowRight, onClick: () => router.push(routes.agent(businessId, agentId)) }}>
            “{tab}” is not a tab of an agent profile. The tabs are {AGENT_TABS.map((t) => t.label).join(", ")}.
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}
