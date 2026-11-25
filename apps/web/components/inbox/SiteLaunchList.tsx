"use client";
/**
 * The "Before it goes live" list on the site's ready note (founder, Nov 25, 2026: "Yes, but it should never be a
 * blocker, it should just show the user."). It only shows the list the note was written with: no action, and nothing it
 * renders touches the note's options.
 */
import { LaunchChecklist } from "@foundmill/dugout";
import { readLaunchChecklist } from "@foundmill/shared/launch-checklist";
import { isSiteReadyDecision } from "@foundmill/shared/sites";

export function SiteLaunchList({ decision }: { decision: unknown }) {
  if (!isSiteReadyDecision(decision)) return null;
  const items = readLaunchChecklist((decision as { launch_checklist?: unknown }).launch_checklist);
  return items ? <LaunchChecklist items={items} /> : null;
}
