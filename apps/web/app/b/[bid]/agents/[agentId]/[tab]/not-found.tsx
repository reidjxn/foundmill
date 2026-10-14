import { AgentNotFound } from "@/components/agents/AgentNotFound";

/** `notFound()` from the agent page (not an agent id, or not a profile tab): the miss is the agent or the tab, not the business. */
export default function AgentPageNotFound() {
  return <AgentNotFound />;
}
