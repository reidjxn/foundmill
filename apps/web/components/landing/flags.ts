/**
 * The landing page's switches and constants (docs/holistic-plan/landing/DIRECTION.md §6). The page is prerendered
 * (`force-static`), so a switch is read once, at build time, from the web deployment's own environment, and passed
 * down. Unset means off, which is what production has today: sign-up closed, the people layer closed, platform mail
 * not confirmed.
 */
import { liveModeOpen } from "@foundmill/config";

/** `/tour`, the earlier page for the second reader, and its footer link from 1280 px (founder, 2026-11-15: keep it). */
export const TOUR_ENABLED = true;

/**
 * The idea box's button (founder, 2026-11-15): "filled", the flat brand primary (`idea-gen-filled`); "recorded" is the
 * dark outlined look of 2026-11-13 (`idea-gen`), kept for an experiment.
 */
export const IDEA_BUTTON: "filled" | "recorded" = "filled";

export interface LandingSwitches {
  /** Open sign-up (`SIGNUP_OPEN`): off, the page says people are let in a few at a time. Indexing follows it. */
  signupOpen: boolean;
  /** The people layer (`LIVE_MODE`, `liveModeOpen`): on, "Find people" shows in the top bar and section 3. */
  peopleOpen: boolean;
  /** Platform mail (`PLATFORM_MAIL_DOMAIN` set): on, the lines that need a confirmation email appear. */
  platformMail: boolean;
}

const on = (v: string | undefined) => /^(1|true|yes|on)$/i.test((v ?? "").trim());

/** The switches from an environment (`process.env` at build time). */
export function landingSwitches(env: Record<string, string | undefined>): LandingSwitches {
  return {
    signupOpen: on(env.SIGNUP_OPEN),
    peopleOpen: liveModeOpen({ LIVE_MODE: env.LIVE_MODE }),
    platformMail: (env.PLATFORM_MAIL_DOMAIN ?? "").trim() !== "",
  };
}

/** Everything off: the page as production has it today. */
export const SWITCHES_OFF: LandingSwitches = { signupOpen: false, peopleOpen: false, platformMail: false };
