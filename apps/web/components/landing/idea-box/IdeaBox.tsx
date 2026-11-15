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
import { ArrowRight, Dices, Fan, Globe, Lock, Mail, Medal, Scale, ShieldCheck, Users } from "lucide-react";
import { CREDITS_CURRENCY, includedCreditsMinor } from "@foundmill/config";
import { AssuranceList, Button, GoogleSignInButton, Icon, IdeaCard, formatMoney, type IdeaCardData } from "@foundmill/dugout";
import { IDEA_BUTTON } from "../flags";
import { IDEA_BOX_INTERESTS, IDEA_BOX_PROMPT_MAX, IDEA_BOX_PROMPT_MIN, IDEA_CLAIM_PARAM, type IdeaBoxEvent, type IdeaBoxInterest } from "@foundmill/shared";
import { NEXT_PARAM } from "@/lib/auth/constants";
import { startGoogleSignIn } from "@/lib/auth/google";
import { googleSignInEnabled, publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
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
  free: "Your first card is free and needs no sign-up",
  private: "Your idea stays private until you choose to share it",
  safe: "Nothing spends money or signs in your name without you",
  // Web research is not live (a1 FR-06), so the keep panel promises the plan and the page, not checked sources.
  keepLead: "Sign in to keep it. Your team starts from your words, drafts a page for it and plans what comes next, and nothing goes out without your yes.",
  keepEmail: "Continue with email",
  freeLine: `Free to start. Your plan includes ${INCLUDED} of agent work every month. You never enter a card.`,
  waits: "Not now? This card waits on this device for 7 days.",
  yourWords: "Your words",
  again: "This is the card this device already holds. Sign in to keep it and draft more with your team.",
  unlockPage: "A page for your idea at its own link",
  unlockDecide: "One decision at a time, each with a recommendation",
  unlockTeam: "A team of agents for the work you have not learned yet",
} as const;

/** Where "Keep this card" goes: sign-in, then /start, which claims the card (the claim token for another device). */
export function keepHref(claim: string | null): string {
  const start = claim ? `/start?${IDEA_CLAIM_PARAM}=${encodeURIComponent(claim)}` : "/start";
  return `/login?${NEXT_PARAM}=${encodeURIComponent(start)}`;
}

type Landed = Extract<IdeaBoxEvent, { type: "card" }>;

export function IdeaBox({ onLanded }: IdeaBoxProps) {
  const env = publicEnv();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [interestsOpen, setInterestsOpen] = useState(false);
  const [phase, setPhase] = useState<IdeaBoxPhase>("rest");
  const [card, setCard] = useState<IdeaCardData>({});
  const [landed, setLanded] = useState<Landed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const widget = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const placeholder = useTypedPlaceholder(PLACEHOLDER_IDEAS, phase === "rest" && !focused && value === "");

  const land = useCallback(
    (e: Landed) => {
      setLanded(e);
      setCard(e.card);
      setPhase("landed");
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
    setError(null);
    setInterestsOpen(false);
    setPhase("drafting");
    setCard({});
    const token = await turnstileToken(env.turnstileSiteKey, widget.current);
    if (!token) {
      setPhase("rest");
      setError("We could not check this browser. Reload the page and try again.");
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    await streamIdeaDraft(env.apiUrl, { ...body, turnstile: token, website: "" }, {
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "partial") setCard((c) => ({ ...c, ...e.card }));
        else if (e.type === "rating") setCard((c) => ({ ...c, attributes: [...(c.attributes ?? []).filter((a) => a.key !== e.rating.key), e.rating] }));
        else if (e.type === "card") land(e);
        else if (e.type === "error") {
          setPhase("rest");
          setCard({});
          setError(e.message);
        }
      },
    });
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

  const keep = keepHref(landed?.claim ?? null);
  const continueWithGoogle = async () => {
    setGoogleBusy(true);
    const supabase = await createClient().catch(() => null);
    if (!supabase) {
      window.location.assign(keep);
      return;
    }
    const url = await startGoogleSignIn(supabase, { env, currentOrigin: window.location.origin, next: new URL(keep, window.location.origin).searchParams.get(NEXT_PARAM) ?? "/start" });
    if (url) window.location.assign(url);
    else window.location.assign(keep);
  };

  const drafting = phase === "drafting";
  const showField = phase !== "landed";

  // One layout for every width (DESIGN §9a): it reads the page's own width (`@page-wide:`, 640 px), never the window's.
  return (
    <div className="flex w-full flex-col items-stretch gap-4" data-idea-box="" data-phase={phase}>
      {showField ? (
        <form onSubmit={submit} className="relative flex w-full flex-col gap-2 text-left" aria-label="Your idea" noValidate>
          <label htmlFor={inputId} className="t-landing-body font-medium text-primary">
            {IDEA_BOX_WORDS.label}
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
                  <span aria-hidden className="idea-input pointer-events-none absolute inset-y-0 left-0 flex items-center overflow-hidden text-tertiary" data-testid="idea-placeholder">
                    <span className="truncate">{placeholder}</span>
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
        <div className="idea-field idea-field-quiet w-full" aria-label="Your idea">
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

      {phase === "rest" ? (
        <>
          <div className="t-landing-small flex flex-wrap items-center gap-x-3 gap-y-2 text-secondary @page-wide:justify-center">
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
            <div className="flex flex-col gap-2 @page-wide:items-center" data-testid="idea-interests">
              <span className="t-landing-small text-secondary">{IDEA_BOX_WORDS.pickInterest}</span>
              <ul className="flex flex-wrap gap-2 @page-wide:justify-center">
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
            className="@page-wide:items-center"
            items={[
              { icon: Medal, text: IDEA_BOX_WORDS.free },
              { icon: Lock, text: IDEA_BOX_WORDS.private },
              { icon: ShieldCheck, text: IDEA_BOX_WORDS.safe },
            ]}
          />
        </>
      ) : null}

      {phase !== "rest" ? (
        // The card, then the ways to keep it, stacked at every width: the hero's column is the 640 px reading measure.
        <div className="mt-3 flex w-full flex-col items-center gap-6" data-testid="idea-result">
          <IdeaCard card={card} drafting={drafting} justIn={phase === "landed" && !landed?.again} sample={landed?.sample ?? false} />
          {phase === "landed" ? (
            <div className="flex w-full min-w-0 flex-col gap-5 text-left" data-testid="idea-keep">
              {landed?.again ? <p className="t-landing-small text-secondary">{IDEA_BOX_WORDS.again}</p> : null}
              <p className="t-landing-body text-prose">{IDEA_BOX_WORDS.keepLead}</p>
              <div className="flex flex-col gap-2.5">
                {googleSignInEnabled(env) ? <GoogleSignInButton onClick={() => void continueWithGoogle()} loading={googleBusy} /> : null}
                <Button asChild variant="glass" size="lg" icon={Mail} iconRight={ArrowRight} className="min-h-tap w-full">
                  <a href={keep} data-testid="idea-keep-email">
                    {IDEA_BOX_WORDS.keepEmail}
                  </a>
                </Button>
                <p className="t-landing-small text-center text-secondary">{IDEA_BOX_WORDS.freeLine}</p>
              </div>
              <ul className="t-landing-body flex flex-col gap-2.5 border-t border-line pt-5 text-secondary">
                <Unlock icon={Globe}>{IDEA_BOX_WORDS.unlockPage}</Unlock>
                <Unlock icon={Scale}>{IDEA_BOX_WORDS.unlockDecide}</Unlock>
                <Unlock icon={Users}>{IDEA_BOX_WORDS.unlockTeam}</Unlock>
              </ul>
              <p className="t-landing-small text-secondary">{IDEA_BOX_WORDS.waits}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {phase === "drafting" ? `Your team is shaping ${card.name ?? "your idea"}` : phase === "landed" ? `${card.name ?? "Your card"} is ready` : ""}
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

