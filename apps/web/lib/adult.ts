/**
 * "I am 18 or older" (0104): the api's refusal of a step that needs it, which the screens that ask recognize.
 */

/** The api's refusal code (apps/api services/adults.ts `ADULT_UNCONFIRMED_CODE`). */
export const ADULT_UNCONFIRMED_CODE = "adult_unconfirmed";

/**
 * Whether the api refused because "I am 18 or older" is not on record: the screen then asks for it, whatever it
 * believed before. Read from the error's `data.appCode` (a tRPC client error carries it there).
 */
export function isAdultUnconfirmed(err: unknown): boolean {
  const data = err && typeof err === "object" ? (err as { data?: { appCode?: unknown } }).data : undefined;
  return data?.appCode === ADULT_UNCONFIRMED_CODE;
}
