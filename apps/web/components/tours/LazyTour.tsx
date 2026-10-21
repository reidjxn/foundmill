"use client";
/**
 * The gate in front of a first-visit tour. Most visits never show one (the account finished it, or guidance is off),
 * so nothing of the tour runs for them: no stamping observer, no Coachmark, no Popover root, and its code (Tour, the
 * Coachmark's tour wiring and the definitions) is not even loaded. It loads in the browser only (`ssr: false`), once the
 * account's preferences have answered, guidance is on and the tour is not done. Marking the tour done unmounts it, and
 * "Replay the tour" in Settings › Preferences mounts it again, fresh.
 */
import dynamic from "next/dynamic";
import { useGuidance, type GuidanceState } from "@foundmill/dugout";
import type { TourId } from "./definitions";

const TourById = dynamic(() => import("./Tour").then((m) => m.TourById), { ssr: false });

/** True when this account will see the tour now. Pure; exported for tests. */
export function tourWanted(state: Pick<GuidanceState, "loaded" | "guidance" | "toursDone">, id: TourId): boolean {
  return state.loaded && state.guidance === "on" && !state.toursDone[id];
}

export function LazyTour({ id }: { id: TourId }) {
  const guidance = useGuidance();
  if (!tourWanted(guidance, id)) return null;
  return <TourById id={id} />;
}
