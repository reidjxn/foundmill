"use client";
/**
 * The landing page's idea box (founder, 2026-11-13; docs/IDEA_BOX.md; the canvas Version 6). A signed-out visitor types
 * one line, or opens "Surprise me" and taps an interest, and gets one rated card, streamed as it is written. The card is
 * kept by the api's cookie for 7 days; "Keep this card" signs in and /start claims it into the visitor's deck.
 *
 * States: rest (the placeholder types ideas until the visitor focuses the field), drafting (the card fills in), landed
 * (the card, and the ways to keep it), and a refusal line under the field. A browser that already holds a card lands on
 * it at once (`/idea-box/mine`).
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, Dices, Fan, Globe, Lock, Medal, Scale, ShieldCheck, Users } from "lucide-react";
import { APP_NAME, CREDITS_CURRENCY, includedCreditsMinor } from "@foundmill/config";
import { AssuranceList, Button, Icon, IdeaCard, IdeaNextSteps, cn, formatMoney, isViewportTooSmall, useViewportWidth, type Assurance, type IdeaCardData } from "@foundmill/dugout";
import { IDEA_BUTTON } from "../flags";
import { IDEA_BOX_DEADLINE_MS, IDEA_BOX_ERRORS, IDEA_BOX_INTERESTS, IDEA_BOX_PROMPT_MAX, IDEA_BOX_PROMPT_MIN, IDEA_CLAIM_PARAM, type IdeaBoxEvent, type IdeaBoxInterest } from "@foundmill/shared";
import { KEEP_THEN_PARAM, KEEP_THEN_STUDIO, NEXT_PARAM } from "@/lib/auth/constants";
import { publicEnv } from "@/lib/env";
import { fetchMine, streamIdeaDraft } from "./client";
import { loadTurnstile, turnstileToken } from "./turnstile";
import { PLACEHOLDER_IDEAS, useTypedPlaceholder } from "./typing";

export type IdeaBoxPhase = "rest" | "drafting" | "landed";

export interface IdeaBoxLanded {
  name: string;
  prompt: string;
  interest: string | null;
}

export interface IdeaBoxProps {
  /** Told when a card lands (or a held card is found): the hero changes its headline. */
  onLanded?: (landed: IdeaBoxLanded | null) => void;
  /** The field's visible label; default the first-timer's (a landing variant has its own, words.ts). */
  label?: string;
  /** The ideas the placeholder types; default the first-timer's. */
  ideas?: readonly string[];
  /** "Surprise me" starts open, its interests showing (the page for a visitor with no idea yet). */
  surpriseOpen?: boolean;
  /** The lines under the field; default the box's own three (`IDEA_BOX_WORDS` free, private, safe), as the tour shows them. */
  assurances?: readonly Assurance[];
  /** How the rows under the field sit from 640 px: centered (the tour's hero) or at the start (the landing page's). */
  align?: "center" | "start";
}

const INCLUDED = formatMoney({ amountMinor: includedCreditsMinor("free"), currency: CREDITS_CURRENCY }, { locale: "en-US" });

/**
 * The words the box prints (docs/holistic-plan/landing/DIRECTION.md §4). The label is visible; the placeholder shows
 * once the field has focus (the typed ideas run before that).
 */
export const IDEA_BOX_WORDS = {
  label: "What do you want to make?",
  placeholder: "One sentence is enough. Rough is fine.",
  generate: "Shape my idea",
  drafting: "Shaping",
  noIdea: "No idea yet?",
  surprise: "Surprise me",
  pickInterest: "Pick something you like",
  free: "Shaping your first idea is free and needs no sign-up",
  private: "Your idea stays private until you choose to share it",
  safe: "Nothing spends money or signs in your name without you",
  // WP-03 T1: what signing in does while new people are let in a few at a time (the waitlist holds the card 90 days).
  // Web research is not live (a1 FR-06), so nothing here says the team checks the card against sources. The Studio
  // clause (founder, 2026-11-16) holds: an admitted person's kept card is in the deck the Studio lists (api test
  // "someone not on the invite list joins the waitlist and keeps the card").
  keepLead: `Either way, you sign in first so the idea stays yours. ${APP_NAME} lets new people in a few at a time. If your place is not open yet, we keep your idea for 90 days, and you can shape it in the Ideation Studio as soon as you are in.`,
  freeLine: `Free to start. Your plan includes ${INCLUDED} of agent work every month. You never enter payment details.`,
  waits: "Not now? This idea waits on this device for 7 days.",
  // WP-03 T7 (founder, 2026-11-15: up to 2 redraws a day): the card is replaced, under the same limits. The button and
  // its warning are the design system's `IdeaNextSteps`; this is the way back while the field is open again.
  backTo: (name: string) => `Back to ${name}`,
  yourWords: "Your words",
  again: "This is the idea this device already holds. Sign in to keep it and draft more with your team.",
  unlockPage: "A page for your idea at its own link",
  unlockDecide: "One decision at a time, each with a recommendation",
  unlockTeam: "A team of agents for the work you have not learned yet",
} as const;

/**
 * Where both choices go: sign-in, then /start, which offers to keep the card (the claim token for another device).
 * `studio` ("Shape it in the Ideation Studio") rides along as `?then=studio`: keeping the card then opens the Studio.
 */
export function keepHref(claim: string | null, then: "build" | "studio" = "build"): string {
  const query = new URLSearchParams();
  if (claim) query.set(IDEA_CLAIM_PARAM, claim);
  if (then === "studio") query.set(KEEP_THEN_PARAM, KEEP_THEN_STUDIO);
  const start = query.size ? `/start?${query.toString()}` : "/start";
  return `/login?${NEXT_PARAM}=${encodeURIComponent(start)}`;
}

const DEFAULT_ASSURANCES: readonly Assurance[] = [
  { icon: Medal, text: IDEA_BOX_WORDS.free },
  { icon: Lock, text: IDEA_BOX_WORDS.private },
  { icon: ShieldCheck, text: IDEA_BOX_WORDS.safe },
];

type Landed = Extract<IdeaBoxEvent, { type: "card" }>;

export function IdeaBox({ onLanded, label = IDEA_BOX_WORDS.label, ideas = PLACEHOLDER_IDEAS, surpriseOpen = false, assurances = DEFAULT_ASSURANCES, align = "center" }: IdeaBoxProps) {
  const centered = align === "center";
  const env = publicEnv();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [interestsOpen, setInterestsOpen] = useState(surpriseOpen);
  const [phase, setPhase] = useState<IdeaBoxPhase>("rest");
  const [card, setCard] = useState<IdeaCardData>({});
  const [landed, setLanded] = useState<Landed | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The visitor pressed "Try another idea": the next draft replaces the card this browser holds. */
  const [redrawing, setRedrawing] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const placeholder = useTypedPlaceholder(ideas, phase === "rest" && !focused && value === "");
  // The Ideation Studio is a desktop screen: on a small one the choice says it opens on a computer.
  const small = isViewportTooSmall(useViewportWidth());

  const land = useCallback(
    (e: Landed) => {
      setLanded(e);
      setCard(e.card);
      setPhase("landed");
      setRedrawing(false);
      onLanded?.({ name: e.card.name, prompt: e.prompt, interest: e.interest });
    },
    [onLanded],
  );

  // A browser that already holds a card lands on it.
  useEffect(() => {
    let live = true;
    void fetchMine(env.apiUrl).then((e) => {
      if (live && e && e.type === "card") land(e);
    });
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, [env.apiUrl, land]);

  const warm = () => {
    if (env.turnstileSiteKey) void loadTurnstile();
  };

  const draft = async (body: { prompt: string; interest: IdeaBoxInterest | null }) => {
    if (phase === "drafting") return;
    // "Try another idea" asks the api to replace the card; a refusal goes back to the card the browser still holds.
    const previous = redrawing ? landed : null;
    const fail = (message: string) => {
      if (previous) {
        setPhase("landed");
        setCard(previous.card);
      } else {
        setPhase("rest");
        setCard({});
      }
      setError(message);
    };
    setError(null);
    setInterestsOpen(false);
    setPhase("drafting");
    setCard({});
    const token = await turnstileToken(env.turnstileSiteKey, widget.current);
    if (!token) {
      fail("We could not check this browser. Reload the page and try again.");
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    // WP-03 T7: the api ends a slow card at its deadline; a stream that stalls on the way is stopped here 5 seconds
    // later. The field comes back with the visitor's words still in it (`value` is never cleared).
    const stall = setTimeout(() => {
      controller.abort();
      fail(IDEA_BOX_ERRORS.failed);
    }, IDEA_BOX_DEADLINE_MS + 5_000);
    try {
      await streamIdeaDraft(env.apiUrl, { ...body, turnstile: token, website: "", ...(previous ? { again: true } : {}) }, {
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === "partial") setCard((c) => ({ ...c, ...e.card }));
          else if (e.type === "rating") setCard((c) => ({ ...c, attributes: [...(c.attributes ?? []).filter((a) => a.key !== e.rating.key), e.rating] }));
          else if (e.type === "card") land(e);
          else if (e.type === "error") fail(e.message);
        },
      });
    } finally {
      clearTimeout(stall);
    }
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const prompt = value.trim();
    if (prompt.length < IDEA_BOX_PROMPT_MIN) {
      setError("Write your idea in a sentence.");
      inputRef.current?.focus();
      return;
    }
    void draft({ prompt, interest: null });
  };

  // Back to the field with the card's own words in it (a typo should not be permanent; founder, 2026-11-15). Reached only
  // through `IdeaNextSteps`' warning that the card will be discarded (founder, 2026-11-16).
  const tryAnother = () => {
    if (landed?.prompt) setValue(landed.prompt);
    setRedrawing(true);
    setError(null);
    setCard({});
    setPhase("rest");
    onLanded?.(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // Nothing was replaced yet: the card this browser holds comes back as it was.
  const backToCard = () => {
    if (!landed) return;
    setValue("");
    setError(null);
    land(landed);
  };

  const drafting = phase === "drafting";
  const showField = phase !== "landed";

  // One layout for every width (DESIGN §9a), read from the box's own width (`@container`; `@page-wide:` is 640 px of it),
  // never the window's: the field and "Shape my idea" sit side by side only when the box itself has room, so a box
  // squeezed beside the hero's example at 1024 px stacks them like a phone does (founder, 2026-11-17).
  return (
    <div className="@container flex w-full flex-col items-stretch gap-4" data-idea-box="" data-phase={phase}>
      {showField ? (
        <form onSubmit={submit} className="relative flex w-full flex-col gap-2 text-left" aria-label="Your idea" noValidate>
          <label htmlFor={inputId} className="t-landing-body font-medium text-primary">
            {label}
          </label>
          {/* Generate sits beside the field, never inside it (founder, 2026-11-13); under it on a phone. */}
          <div className="flex flex-col gap-2.5 @page-wide:flex-row @page-wide:items-stretch">
            <div className="idea-field min-w-0 flex-1" data-testid="idea-field">
              <div className="relative flex min-w-0 flex-1 items-center">
                <textarea
                  ref={inputRef}
                  id={inputId}
                  rows={1}
                  maxLength={IDEA_BOX_PROMPT_MAX}
                  value={value}
                  disabled={drafting}
                  onChange={(e) => {
                    setValue(e.target.value.replace(/\n/g, " "));
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      e.currentTarget.form?.requestSubmit();
                    }
                  }}
                  onFocus={() => {
                    setFocused(true);
                    warm();
                  }}
                  onBlur={() => setFocused(false)}
                  aria-describedby={error ? errorId : undefined}
                  aria-invalid={error ? true : undefined}
                  placeholder={focused ? IDEA_BOX_WORDS.placeholder : ""}
                  className="idea-input min-h-12 py-3"
                  data-testid="idea-input"
                />
                {/* The typing placeholder: decorative, under the empty field until the visitor clicks in. */}
                {!focused && value === "" && !drafting ? (
                  // Pinned to the text area on both sides, so an example longer than the field is clipped with an ellipsis
                  // instead of running out of it (founder, 2026-11-17). The examples are written to fit (typing.ts).
                  <span aria-hidden className="idea-input pointer-events-none absolute inset-0 flex items-center overflow-hidden text-tertiary" data-testid="idea-placeholder">
                    <span className="min-w-0 truncate">{placeholder}</span>
                    <span className="idea-caret" />
                  </span>
                ) : null}
              </div>
            </div>
            <button type="submit" className={IDEA_BUTTON === "filled" ? "idea-gen-filled" : "idea-gen min-h-tap"} disabled={drafting} data-testid="idea-generate">
              {IDEA_BUTTON === "filled" ? (
                <Icon icon={Fan} size={18} className={drafting ? "motion-safe:animate-spin" : undefined} />
              ) : (
                <span className="idea-gen-core">
                  <Icon icon={Fan} size={18} className={drafting ? "motion-safe:animate-spin" : undefined} />
                </span>
              )}
              {drafting ? IDEA_BOX_WORDS.drafting : IDEA_BOX_WORDS.generate}
            </button>
          </div>
          {/* The invisible Turnstile widget renders here. */}
          <div ref={widget} className="absolute" aria-hidden />
        </form>
      ) : (
        <div className="idea-field idea-field-quiet landing-measure w-full" aria-label="Your idea">
          <span className="idea-input truncate py-3" data-testid="idea-landed-words">
            {landed?.prompt || `${IDEA_BOX_WORDS.surprise}: ${landed?.interest ?? ""}`}
          </span>
          {landed?.prompt ? <span className="t-small mr-1 hidden shrink-0 items-center rounded-xs px-2 py-1 text-accent @page-wide:inline-flex">{IDEA_BOX_WORDS.yourWords}</span> : null}
        </div>
      )}

      {error ? (
        <p id={errorId} role="alert" className="t-landing-body text-status-warn" data-testid="idea-error">
          {error}
        </p>
      ) : null}

      {phase === "rest" && redrawing && landed ? (
        <Button variant="ghost" icon={ArrowLeft} className={cn("min-h-tap self-start", centered && "@page-wide:self-center")} onClick={backToCard} data-testid="idea-back-to-card">
          {IDEA_BOX_WORDS.backTo(landed.card.name)}
        </Button>
      ) : null}

      {phase === "rest" ? (
        <>
          <div className={cn("t-landing-small flex flex-wrap items-center gap-x-3 gap-y-2 text-secondary", centered && "@page-wide:justify-center")}>
            <span>{IDEA_BOX_WORDS.noIdea}</span>
            <Button
              variant="default"
              icon={Dices}
              className="min-h-tap"
              aria-expanded={interestsOpen}
              onClick={() => {
                setInterestsOpen((o) => !o);
                warm();
              }}
              data-testid="idea-surprise"
            >
              {IDEA_BOX_WORDS.surprise}
            </Button>
          </div>
          {interestsOpen ? (
            <div className={cn("flex flex-col gap-2", centered && "@page-wide:items-center")} data-testid="idea-interests">
              <span className="t-landing-small text-secondary">{IDEA_BOX_WORDS.pickInterest}</span>
              <ul className={cn("flex flex-wrap gap-2", centered && "@page-wide:justify-center")}>
                {IDEA_BOX_INTERESTS.map((interest) => (
                  <li key={interest}>
                    <Button variant="default" className="min-h-tap" onClick={() => void draft({ prompt: "", interest })}>
                      {interest}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <AssuranceList
            className={centered ? "@page-wide:items-center" : undefined}
            items={assurances}
          />
        </>
      ) : null}

      {phase !== "rest" ? (
        // The card, wide, and what to do with it: beside it once the result has the hero's full column (880 px), under it
        // before that (founder, 2026-11-16: "the card should be wider so as to take up more space").
        <div className="@container mt-3 w-full" data-testid="idea-result">
          <div className={cn("landing-result-grid", centered && "text-left")}>
            {/* The product's own screen: night, wherever the box stands (landing.css `world-night`). */}
            <IdeaCard card={card} wide drafting={drafting} justIn={phase === "landed" && !landed?.again} sample={landed?.sample ?? false} className="world-night landing-screen-lit" />
            {phase === "landed" && landed ? (
              <IdeaNextSteps
                name={landed.card.name}
                studioHref={keepHref(landed.claim, "studio")}
                buildHref={keepHref(landed.claim)}
                studioOnComputer={small}
                redrawsLeft={landed.redrawsLeft ?? null}
                onRedraw={tryAnother}
                lead={
                  <>
                    {landed.again ? <p className="t-landing-small text-secondary">{IDEA_BOX_WORDS.again}</p> : null}
                    <p className="t-landing-body text-prose">{IDEA_BOX_WORDS.keepLead}</p>
                  </>
                }
              >
                <p className="t-landing-small text-secondary">{IDEA_BOX_WORDS.freeLine}</p>
                <ul className="t-landing-body flex flex-col gap-2.5 text-secondary">
                  <Unlock icon={Globe}>{IDEA_BOX_WORDS.unlockPage}</Unlock>
                  <Unlock icon={Scale}>{IDEA_BOX_WORDS.unlockDecide}</Unlock>
                  <Unlock icon={Users}>{IDEA_BOX_WORDS.unlockTeam}</Unlock>
                </ul>
                <p className="t-landing-small text-secondary">{IDEA_BOX_WORDS.waits}</p>
              </IdeaNextSteps>
            ) : null}
          </div>
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {phase === "drafting" ? `Your team is shaping ${card.name ?? "your idea"}` : phase === "landed" ? `${card.name ?? "Your idea"} is ready` : ""}
      </span>
    </div>
  );
}

function Unlock({ icon, children }: { icon: typeof Medal; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon icon={icon} size="default" className="text-accent" />
      {children}
    </li>
  );
}

