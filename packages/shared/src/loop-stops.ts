/**
 * "When the team stops" (item 10, Nov 13, 2026): one list, per project, of the situations in which the team's loop of
 * work stops, read-only on Settings › What the team can do. Only what the code enforces today, each with what happens:
 *
 * - **Asks you first** (the Cedar policies in packages/policy, for the mode in force and the spend line; the plan's
 *   kit-mode rule; the Continue and Autopilot decisions in autopilot.ts): what always comes to the founder, spending
 *   over the line, outside contact (the first answer), a step that cannot be undone (first and second answers), a
 *   contract (the second answer), putting changes live (every answer), a channel run in offline tracking, used-up
 *   credits, a note that holds up the work, and Autopilot's own pause after failed or empty cycles.
 * - **Stops on its own**, no question needed: a person who unsubscribed, reported spam or bounced is never emailed
 *   again (the suppression list), an address first seen in outside content is not contacted until verified, and the
 *   project's daily email limit.
 *
 * packages/policy `loop-stops.test.ts` holds the "asks" entries to Cedar through the same principal the gateway builds,
 * so the list cannot claim an ask the policies do not make, or miss one they do. Situations from the "one-person
 * marketing team" list that the code does not implement (a post taking off, an angry comment, a risky claim, credits
 * running low before they run out) are not listed. US English; no "policy", "cap" or "hard gate" (the page's own rule).
 */
import type { BusinessMode } from "./constants";
import { eachAgentLimitLabel, spendAmountWords, spendLineKind, type SpendLineInput } from "./team-can-do";

export const LOOP_STOPS_TITLE = "When the team stops";

export const LOOP_STOPS_INTRO = "Every situation below pauses the work it touches. The rest of the team's work carries on.";

export type LoopStopId = "always_yours" | "spend" | "outside" | "permanent" | "contract" | "release" | "offline_channel" | "credits" | "holds_work" | "autopilot_idle" | "unsubscribed" | "unverified_address" | "daily_email";

export interface LoopStop {
  id: LoopStopId;
  /** The situation, as the founder would say it. */
  when: string;
  /** What happens then. */
  then: string;
}

export interface LoopStops {
  /** The mode the list is for: on vacation that is the third answer's, whatever was chosen. */
  modeInForce: BusinessMode;
  /** The team stops and asks the founder (or tells them in Needs you). */
  asks: LoopStop[];
  /** The team stops on its own; nothing is asked. */
  stops: LoopStop[];
}

export interface LoopStopsInput extends SpendLineInput {
  mode: BusinessMode;
  holiday?: boolean;
  /** Autopilot's own settings when it is on; null or off: its line is left out. */
  autopilot?: { enabled: boolean; maxIdleCycles: number } | null;
}

const ASKS = "The team asks you first.";

function spendWhen(input: SpendLineInput, mode: BusinessMode): string {
  const kind = spendLineKind(input.lineMinor);
  if (mode === "augmented" || kind === "always") return "Any purchase, whatever it costs";
  if (kind === "amount" && input.currency) return `A purchase over ${spendAmountWords(input.lineMinor as number, input.currency)}, or over the agent's own limit when that is lower`;
  // "Each agent's own limit (£250 unless you set one)", said of the agent that is buying.
  return `A purchase over ${eachAgentLimitLabel(input).replace(/^Each agent's/, "the agent's")}`;
}

/** The list for one project's settings. */
export function loopStops(input: LoopStopsInput): LoopStops {
  const mode: BusinessMode = input.holiday ? "automated" : input.mode;
  const asks: LoopStop[] = [
    {
      id: "always_yours",
      when: "Moving money, signing, filing in your name, accepting terms, deleting for good, or changing a security setting such as your domain's email records",
      then: "Always comes to you. The team prepares it and never does it itself.",
    },
    { id: "spend", when: spendWhen(input, mode), then: ASKS },
  ];
  if (mode === "augmented") asks.push({ id: "outside", when: "Contacting anyone outside the project: an email, a message or a comment", then: ASKS });
  if (mode !== "automated") asks.push({ id: "permanent", when: "A step that can't be undone (sending an email counts)", then: ASKS });
  if (mode === "assisted") asks.push({ id: "contract", when: "Drafting or changing a contract", then: ASKS });
  asks.push(
    { id: "release", when: "Putting changes live in your product", then: "The team asks you first, unless you handed this to an agent in Team › Responsibilities." },
    { id: "offline_channel", when: "A channel that can't be run automatically within its own rules", then: "The agent prepares everything and you submit it yourself." },
    { id: "credits", when: "The credits run out", then: "The team pauses and tells you in Needs you. It picks up where it stopped after a top-up or once your own key is added." },
    { id: "holds_work", when: "A question only you can answer holds up the work", then: "The team finishes the cycle it is in and waits for your answer before starting the next one." },
  );
  if (input.autopilot?.enabled) {
    const n = input.autopilot.maxIdleCycles;
    asks.push({ id: "autopilot_idle", when: `${n === 1 ? "A cycle fails" : `${n.toLocaleString("en-US")} cycles in a row fail`} or get nothing done`, then: "Autopilot pauses itself and leaves a note in the Inbox. It starts again when you turn it back on." });
  }
  const stops: LoopStop[] = [
    { id: "unsubscribed", when: "Someone unsubscribes, reports spam, or their email bounces", then: "The project never emails them again." },
    { id: "unverified_address", when: "An address the team first saw in a web page, an email or a reply", then: "The team doesn't contact it until it is verified." },
    { id: "daily_email", when: "The project has sent its emails for the day", then: "Sending waits until midnight UTC." },
  ];
  return { modeInForce: mode, asks, stops };
}
