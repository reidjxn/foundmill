/**
 * Records with a key limit counted before zod reads a key (GHSA-mrhx-c7xc-m3w5).
 *
 * zod checks a record key by key and builds an issue per failing key, and it has no way to cap a record's size before
 * it does: a `.refine` on the size runs after every key. A 2 MB body of junk keys made the api build hundreds of
 * thousands of issues. `boundedRecord` counts the keys of a plain object first, stopping past the limit, so oversized
 * or odd input (a Map, an array, an object with another prototype) is one short issue; then the record parses as before.
 */
import { z } from "zod";

/**
 * A guard that is true for a plain object (prototype `Object.prototype`) with at most `max` keys, counted with
 * `for…in` and stopping at the first key past `max`.
 */
export function fewKeys(max: number): (value: unknown) => boolean {
  return (value) => {
    if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) return false;
    let n = 0;
    for (const _key in value) if (++n > max) return false;
    return true;
  };
}

/** The message a record over its limit is refused with, unless the caller names its own. */
export const boundedRecordMessage = (max: number): string => `At most ${max.toLocaleString("en-US")} entries`;

/**
 * `record`, refused at once (one issue) unless the input is a plain object with at most `max` keys. Use it for every
 * `z.record`/`z.partialRecord` a request can reach.
 */
export function boundedRecord<T extends z.ZodType<unknown, Record<string, unknown>>>(max: number, record: T, message: string = boundedRecordMessage(max)) {
  return z.custom<Record<string, unknown>>(fewKeys(max), { message }).pipe(record);
}
