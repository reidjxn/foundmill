/**
 * The words of the public waitlist page (WP-14 T15, the founder's sentence of 2026-11-17: "Foundmill opens in batches.
 * Batch N opens <day>. <n> places."). The numbers are the API's real ones (`waitlist.batch`); with no batch set the
 * page says so and shows none. US dates, read in UTC so every reader sees the batch's own day.
 */
import { APP_NAME } from "@foundmill/config";
import { countOf, usDate } from "@foundmill/shared";

export const WAITLIST_PAGE_WORDS = {
  title: `${APP_NAME} opens in batches`,
  description: `${APP_NAME} opens in batches. See when the next batch opens and how many places it has, and join the waitlist.`,
  none: "The next batch has no date yet. Join the waitlist and your place is held for it.",
  unavailable: "The next batch could not be loaded just now. Reload the page in a minute.",
  how: "Signing in with your email address saves your place on the waitlist.",
  join: "Join the waitlist",
  about: `What ${APP_NAME} is`,
} as const;

/** "Batch 3 opens Nov 24, 2026. 50 places." before its day; "Batch 3 opened Nov 24, 2026. 12 places left." from it. */
export function waitlistBatchLine(batch: { number: number; opensOn: string; placesLeft: number; open: boolean }): string {
  const day = usDate(`${batch.opensOn}T00:00:00Z`);
  const places = countOf(batch.placesLeft, "place");
  return batch.open ? `Batch ${batch.number} opened ${day}. ${places} left.` : `Batch ${batch.number} opens ${day}. ${places}.`;
}
