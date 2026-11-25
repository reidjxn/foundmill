/**
 * The "before it goes live" checklist (founder, Nov 25, 2026): shown once, in the dialog where the founder approves the
 * public page going live for the first time. It says what is ready and what is not, and it never blocks: "It should
 * definitely not block. Nothing can ever block! No blocking!!!" Publish stays one press with every item "Not yet".
 *
 * Each item is computed from what the page already holds; an item the code cannot judge truthfully is left out, never
 * shown as ready. Left out for now: booking (it needs a published page to go live, so it is never ready here), taking
 * payment (the public page has no price or payment link) and the design check (it reviews the team's site code, not the
 * public page). A "Not yet" reads as something the team or the founder can do next, never as the project being behind.
 */
import { pageIsListed, PAGE_NOT_LISTED_LINE, type ProjectPageContent } from "./project-page";

export type LaunchCheckId = "phone" | "visitor_action" | "sharing" | "search" | "consent";

export interface LaunchCheck {
  id: LaunchCheckId;
  label: string;
  ready: boolean;
  /** One plain sentence. */
  line: string;
  /** The one thing that would make it ready, when there is one (an offer, never a requirement). */
  action?: { id: "turn_on_follow"; label: string };
}

export const LAUNCH_CHECKLIST_WORDS = {
  title: "Before it goes live",
  ready: "Ready",
  notYet: "Not yet",
  note: "You can publish now either way. Anything marked Not yet can be done after it is live.",
} as const;

/** True only before the page has ever been public: never live, never taken down. */
export const isFirstLaunch = (page: { live: boolean; publishedAt: unknown; unpublishedAt: unknown }): boolean => !page.live && !page.publishedAt && !page.unpublishedAt;

/** The checklist for a page about to go live, in display order. */
export function launchChecklist(input: { name: string; content: ProjectPageContent }): LaunchCheck[] {
  const { content } = input;
  const items: LaunchCheck[] = [
    // The page is drawn by one component that is built and tested from 390 px (apps/web /p/<slug>).
    { id: "phone", label: "Works on a phone", ready: true, line: "The page is built to read well on a phone as well as a computer." },
    content.followForm
      ? { id: "visitor_action", label: "A way for visitors to act", ready: true, line: "Visitors can follow the project with their email, so you can tell them what comes next." }
      : {
          id: "visitor_action",
          label: "A way for visitors to act",
          ready: false,
          line: "Visitors can read the page, and the Follow form would let them leave their email for updates.",
          action: { id: "turn_on_follow", label: "Turn on the Follow form" },
        },
    content.pitch.trim()
      ? { id: "sharing", label: "Ready to share", ready: true, line: "A shared link shows the project's name, the one-line pitch and a preview image." }
      : { id: "sharing", label: "Ready to share", ready: false, line: "A shared link shows the one-line pitch once it is written." },
    pageIsListed(input).listed
      ? { id: "search", label: "Found by search engines", ready: true, line: "Search engines can list the page." }
      : { id: "search", label: "Found by search engines", ready: false, line: PAGE_NOT_LISTED_LINE },
  ];
  // Only a page that collects something needs to say what a visitor agrees to.
  if (content.followForm) items.push({ id: "consent", label: "Clear about email", ready: true, line: "The Follow form says what visitors agree to and that they can unsubscribe at any time." });
  return items;
}
