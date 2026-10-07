"use client";
/**
 * Placeholder for surfaces the next build stage replaces (Home, Inbox, Journey, agents, CRM, milestones,
 * onboarding, new business). On-brand, says what will appear and how (DESIGN §10); never a blank page.
 */
import { Construction, type LucideIcon } from "lucide-react";
import { EmptyState, Panel } from "@foundmill/dugout";

export interface ComingSoonProps {
  title: string;
  /** What will appear here, in one line. */
  description: string;
  icon?: LucideIcon;
  /** Optional detail line (route params, ids) in mono. */
  detail?: string;
}

export function ComingSoon({ title, description, icon = Construction, detail }: ComingSoonProps) {
  return (
    <div className="p-gutter" data-testid="coming-soon">
      <Panel title={title} span={12}>
        <EmptyState icon={icon} title={`${title} is coming in this build`}>
          {description}
        </EmptyState>
        {detail ? <p className="mt-2 text-center font-mono text-mono text-secondary">{detail}</p> : null}
      </Panel>
    </div>
  );
}
