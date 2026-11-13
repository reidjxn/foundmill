/**
 * An invitation to a project, as the person it is for sees it at `/i/<token>` (docs/NETWORK.md F5; THESIS_REVIEW
 * package 3.1; DESIGN §9f): who invited them, to what, as what (the role in one plain sentence), and the way on. One
 * column from 390 px, every control at least 44 px tall (`min-h-tap`).
 *
 * Presentational and server-safe: the caller passes the actions (Accept and Not now, or "Sign in to accept", as buttons
 * or links) and owns what they do. `unavailable` is the one answer for every invitation that no longer works (unknown,
 * expired, revoked, used, declined): it says so and how to get a new one, and names nobody.
 */
import type { ReactNode } from "react";
import { MailCheck, MailX } from "lucide-react";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";

export type InvitationCardState = "pending" | "unavailable" | "accepted" | "declined";

export interface InvitationCardProps {
  state: InvitationCardState;
  /** The project's name. */
  projectName?: string | null;
  /** The inviter's display name; null when they have none yet ("A founder of ‹project›"). */
  inviterName?: string | null;
  /** "Cofounder" / "Collaborator". */
  roleWord?: string | null;
  /** One plain sentence: what the role can do. */
  roleSentence?: string | null;
  /** The way on: buttons or links, the first the main one. */
  actions?: ReactNode;
  /** A line under the actions (an error the last press came to). */
  note?: ReactNode;
  className?: string;
}

/** The words for each state, exported for the tests and the page's title. */
export function invitationCardWords(p: Pick<InvitationCardProps, "state" | "projectName" | "inviterName" | "roleWord">): { title: string; lead: string | null } {
  const project = p.projectName?.trim() || "a project";
  switch (p.state) {
    case "pending":
      return { title: `${p.inviterName?.trim() || `A founder of ${project}`} invited you to ${project}`, lead: p.roleWord ? `As a ${p.roleWord.toLowerCase()}` : null };
    case "accepted":
      return { title: `You're in ${project}`, lead: null };
    case "declined":
      return { title: "Invitation declined", lead: "Nothing else happens, and nobody is told who you are." };
    default:
      return { title: "This invitation no longer works", lead: "It may have expired or been used already. Ask the person who invited you for a new link." };
  }
}

export function InvitationCard({ state, projectName, inviterName, roleWord, roleSentence, actions, note, className }: InvitationCardProps) {
  const words = invitationCardWords({ state, projectName, inviterName, roleWord });
  const ok = state === "pending" || state === "accepted";
  return (
    <section data-invitation-card={state} aria-labelledby="invitation-title" className={cn("flex min-w-0 flex-col gap-4 rounded-md border border-line bg-panel p-4 @page-wide:p-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-sm", ok ? "bg-panel-alt text-kit" : "bg-panel-alt text-secondary")}>
          <Icon icon={ok ? MailCheck : MailX} size={16} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id="invitation-title" className="t-title min-w-0 break-words text-primary">
            {words.title}
          </h1>
          {words.lead ? <p className="t-body-strong break-words text-secondary">{words.lead}</p> : null}
        </div>
      </div>
      {state === "pending" && roleSentence ? <p className="t-body break-words text-prose">{roleSentence}</p> : null}
      {actions ? <div className="flex min-w-0 flex-col gap-2 @page-wide:flex-row @page-wide:flex-wrap">{actions}</div> : null}
      {note ? (
        <p role="status" className="t-body break-words text-secondary" data-invitation-note="">
          {note}
        </p>
      ) : null}
    </section>
  );
}
