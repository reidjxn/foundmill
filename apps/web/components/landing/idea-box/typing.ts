/**
 * The placeholder that types one idea after another until the visitor clicks into the field (founder, 2026-11-13; the
 * canvas): a character every 42 ms, a 1.8 s hold, erased at 16 ms a character, 260 ms before the next. Reduced motion:
 * the first idea, still. Stops (and keeps nothing) once `running` is false.
 */
import { useEffect, useState } from "react";

export const TYPING = { typeMs: 42, holdMs: 1_800, eraseMs: 16, gapMs: 260, startMs: 400 } as const;

/**
 * The longest example the placeholder may type: it fits whole in the field's text area at its narrowest, 314 px at a
 * 390 px phone (Playwright "the examples stay inside the field", every width from 390 to 1440 px). Longer text is
 * clipped with an ellipsis rather than leaving the field (founder, 2026-11-17).
 */
export const PLACEHOLDER_IDEA_MAX = 34;

/**
 * The ideas the placeholder types (s2 §3.4, DIRECTION §4; founder, 2026-11-17: "more inspiring than weekly emails about
 * cheap eats"): things a first-timer could start this month with little money and no code, across kinds (food, a local
 * service, something made by hand, teaching online, selling to businesses, a game, an event), so the first example a
 * visitor reads is something they would be glad to own. The first is the one reduced motion shows.
 */
export const PLACEHOLDER_IDEAS = [
  "Hot sauce from my grandma's recipe",
  "Bike repairs that come to you",
  "Pet portraits in watercolor",
  "Guitar lessons over video call",
  "Plant care for offices near me",
  "Old chairs, restored and resold",
  "A board game about running a farm",
  "Ramen pop-ups in my backyard",
] as const;

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function useTypedPlaceholder(ideas: readonly string[], running: boolean): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!running || ideas.length === 0) return;
    if (reducedMotion()) {
      setText(ideas[0]!);
      return;
    }
    let i = 0;
    let n = 0;
    let phase: "type" | "hold" | "erase" = "type";
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const idea = ideas[i]!;
      if (phase === "type") {
        if (n < idea.length) {
          n += 1;
          setText(idea.slice(0, n));
          timer = setTimeout(step, TYPING.typeMs);
        } else {
          phase = "hold";
          timer = setTimeout(step, TYPING.holdMs);
        }
      } else if (phase === "hold") {
        phase = "erase";
        timer = setTimeout(step, TYPING.eraseMs);
      } else if (n > 0) {
        n -= 1;
        setText(idea.slice(0, n));
        timer = setTimeout(step, TYPING.eraseMs);
      } else {
        i = (i + 1) % ideas.length;
        phase = "type";
        timer = setTimeout(step, TYPING.gapMs);
      }
    };
    timer = setTimeout(step, TYPING.startMs);
    return () => clearTimeout(timer);
  }, [ideas, running]);
  return running ? text : "";
}
