/**
 * Reading a streamed logo set (`idea.logo.stream` / `business.logo.stream`, audit P6): the api draws the four marks in
 * parallel and streams `started` (the slots), each `option` as it passes the server's check, `failed` for a slot that
 * ended without a usable mark, then `done` with the whole set. `readLogoStream` forwards the progress to the picker and
 * resolves with the set; a stream that ends without `done` is an error.
 */
import type { GeneratedLogoOption, GeneratedLogoSet, LogoProgress } from "./LogoPicker";

/** One event of a streamed set as the api sends it (`LogoEvent` in apps/api services/logo.ts). */
export type LogoStreamEvent =
  | { type: "started"; total: number; slots: { index: number; direction: string; label: string }[]; mode: "mock" | "live" }
  | { type: "option"; index: number; option: GeneratedLogoOption }
  | { type: "failed"; index: number; message: string }
  | { type: "done"; set: GeneratedLogoSet };

export async function readLogoStream(stream: AsyncIterable<LogoStreamEvent>, onProgress?: (progress: LogoProgress) => void): Promise<GeneratedLogoSet> {
  for await (const event of stream) {
    switch (event.type) {
      case "started":
        onProgress?.({ type: "started", slots: event.slots.map((s) => ({ index: s.index, label: s.label })) });
        break;
      case "option":
        onProgress?.({ type: "option", index: event.index, option: event.option });
        break;
      case "failed":
        onProgress?.({ type: "failed", index: event.index, message: event.message });
        break;
      case "done":
        return event.set;
    }
  }
  throw new Error("The logo designer stopped before the set was finished. Try again.");
}
