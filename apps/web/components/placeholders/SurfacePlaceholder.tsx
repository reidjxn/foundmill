"use client";
/** One placeholder per fixed surface the next build stage replaces; the shell chrome (title) is set here. */
import { Bot, Inbox, Route, Trophy, Users, type LucideIcon } from "lucide-react";
import { useShellChrome } from "@/components/shell/chrome";
import { ComingSoon } from "@/components/shell/ComingSoon";

export type PlaceholderSurface = "inbox" | "journey" | "agent" | "crm" | "entity" | "milestones";

const COPY: Record<PlaceholderSurface, { title: string; description: string; icon: LucideIcon }> = {
  inbox: { title: "Inbox", icon: Inbox, description: "A 380 px list with Respond, Customers, Updates and Archive tabs, the reading pane with the note, status strip, exhibit and the DecisionBar. The Inbox build renders it here." },
  journey: { title: "Customer Update", icon: Route, description: "The replay of a won customer: first touch, who was involved, the win moment and the debrief. The Journey build renders it here." },
  agent: { title: "Agent profile", icon: Bot, description: "Profile header, skill grid, position map, traits, coach report and training. The agents build renders it here." },
  crm: { title: "CRM", icon: Users, description: "Every person and organization with saved views, filters and universal search. The CRM build renders it here." },
  entity: { title: "Entity profile", icon: Users, description: "Overview, activity, relationships, commercial, documents, notes and journey tabs. The CRM build renders it here." },
  milestones: { title: "Milestones", icon: Trophy, description: "Customer and revenue milestones, releases, decisions, incorporation and launches. The Home build renders the cabinet here." },
};

export function SurfacePlaceholder({ surface, detail, title }: { surface: PlaceholderSurface; detail?: string; title?: string }) {
  const copy = COPY[surface];
  useShellChrome({ title: title ?? copy.title }, [title, copy.title]);
  return <ComingSoon title={title ?? copy.title} icon={copy.icon} description={copy.description} detail={detail} />;
}
