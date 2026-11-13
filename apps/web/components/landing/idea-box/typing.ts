/**
 * The placeholder that types one idea after another until the visitor clicks into the field (founder, 2026-11-13; the
 * canvas): a character every 42 ms, a 1.8 s hold, erased at 16 ms a character, 260 ms before the next. Reduced motion:
 * the first idea, still. Stops (and keeps nothing) once `running` is false.
 */
import { useEffect, useState } from "react";

export const TYPING = { typeMs: 42, holdMs: 1_800, eraseMs: 16, gapMs: 260, startMs: 400 } as const;

/** The ideas the placeholder types (the canvas's eight). */
export const PLACEHOLDER_IDEAS = [
  "An AI teaching assistant for independent tutors",
  "Restored film cameras for people buying their first one",
  "A weekly meal plan for people training for their first marathon",
  "Playtesters that try every build of an indie game",
  "Spanish lessons for kids, built around the shows they watch",
  "A booking page and reminders for independent barbers",
  "Skincare made for cold, dry winters",
  "Bookkeeping for small cafes, done overnight",
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
