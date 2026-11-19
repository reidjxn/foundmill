/**
 * The founder's own task on Today (WP-04 T9; onboarding: one goal per session, end on a positive note): the one thing
 * the founder can finish in minutes, and what happens next. Pure and from facts the api already reads in `today.get`:
 * the page (`project_pages`), a share of the page that was opened (`share.opened`, kind `page`), the open plan note, and
 * a real follow or reply (`page.followed`, `lead.replied`, never a simulated one). No table, no event, no model call.
 *
 * The order is publish → share → approve the plan → ask five. A share counts once the founder pressed a share control
 * for the page: that moves the task on and nothing more (the north star never counts it). "Ask five" is done only by a
 * real outside answer. Null when everything is done.
 *
 * One task a day: once the founder finished one today (`doneToday`), Today reads "Done for today." and names the next
 * one for tomorrow. WP-08 adds outreach tasks by extending `FounderTaskId` and this function, never with a second panel.
 *
 * Pure, no Zod: browser code imports this from "@foundmill/shared/founder-task".
 */
import { postTextWithLink } from "./post-draft";
import { pageAskText } from "./share-drafts";

export type FounderTaskId = "publish_page" | "share_page" | "approve_plan" | "ask_five";

/** The order the tasks come in: the first one not done is today's. */
export const FOUNDER_TASK_ORDER: readonly FounderTaskId[] = Object.freeze(["publish_page", "share_page", "approve_plan", "ask_five"]);

export interface FounderTaskAction {
  label: string;
  /** Open Product › Public page; share the message; open the plan note; copy the message. */
  kind: "open_page" | "share" | "open_note" | "copy";
  /** The message, with the page's address, for `share` and `copy`. */
  text?: string;
}

export interface FounderTask {
  id: FounderTaskId;
  title: string;
  why: string;
  action: FounderTaskAction;
  /** What happens next, under a rule. */
  tomorrow: string;
  /** The founder already finished a task today: Today reads "Done for today." and names this one for tomorrow. */
  doneToday: boolean;
}

export interface FounderTaskFacts {
  /** A page is live now (`project_pages.published`). */
  pagePublished: boolean;
  /** A share of the page was opened (`share.opened` with kind `page`). */
  pageShared: boolean;
  /** The plan note waits for the founder's approval. */
  planNoteOpen: boolean;
  /** A real follow or reply came in (`page.followed`, `lead.replied`), never a simulated one. */
  outsideSignal: boolean;
  projectName: string;
  /** The live page's one-line pitch. */
  pitch: string | null;
  /** The live page's address, with its `via` reference. */
  url: string | null;
  /** The overnight shift is on (Autopilot daily, not paused): tomorrow morning brings what the team found. */
  overnight: boolean;
  /** The tasks the founder finished today, in the project's calendar. Absent reads as none. */
  doneToday?: readonly FounderTaskId[];
}

export const FOUNDER_TASK_WORDS = {
  title: "Your one thing today",
  doneToday: "Done for today.",
  tomorrowPrefix: "Tomorrow:",
  overnight: "Tomorrow morning: what your team found overnight, and one thing to do.",
  noOvernight: "Come back when you have heard from someone, or press Continue for a round of work.",
} as const;

/** The message the founder sends, with the page's address (the public page's own "Copy message" words). */
export function founderAskMessage(f: Pick<FounderTaskFacts, "projectName" | "pitch" | "url">): string {
  return postTextWithLink({ text: pageAskText(f.projectName, f.pitch), link: f.url ?? undefined });
}

function done(id: FounderTaskId, f: FounderTaskFacts): boolean {
  switch (id) {
    case "publish_page":
      return f.pagePublished;
    case "share_page":
      return f.pagePublished && f.pageShared;
    case "approve_plan":
      // Only an open plan note is the founder's to approve; while it is drafted or revised, nothing waits on them.
      return !f.planNoteOpen;
    case "ask_five":
      return f.outsideSignal;
  }
}

function words(id: FounderTaskId, f: FounderTaskFacts): Pick<FounderTask, "title" | "why" | "action"> {
  switch (id) {
    case "publish_page":
      return { title: "Check your page and publish it", why: "It is the first thing of yours that people outside can see.", action: { label: "Check my page", kind: "open_page" } };
    case "share_page":
      return { title: "Send your page to three people", why: "Ask if they would use it. What they say shapes what your team does next.", action: { label: "Share my page", kind: "share", text: founderAskMessage(f) } };
    case "approve_plan":
      return { title: "Read your plan and approve it", why: "Five lines. Your team starts building when you do.", action: { label: "Read my plan", kind: "open_note" } };
    case "ask_five":
      return { title: "Ask five people the question on your page", why: "One real answer tells your team more than a week of guessing.", action: { label: "Copy the message", kind: "copy", text: founderAskMessage(f) } };
  }
}

/** Today's one task for the founder, or null when every task is done. */
export function founderTaskOf(f: FounderTaskFacts): FounderTask | null {
  const id = FOUNDER_TASK_ORDER.find((t) => !done(t, f));
  if (!id) return null;
  return { id, ...words(id, f), tomorrow: f.overnight ? FOUNDER_TASK_WORDS.overnight : FOUNDER_TASK_WORDS.noOvernight, doneToday: (f.doneToday ?? []).length > 0 };
}
