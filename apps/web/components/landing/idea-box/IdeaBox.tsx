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
import { ArrowRight, Columns2, Dices, Fan, Lock, Mail, Medal, Search, ShieldCheck, Users } from "lucide-react";
import { CREDITS_CURRENCY, includedCreditsMinor } from "@foundmill/config";
import { Button, GoogleSignInButton, Icon, IdeaCard, cn, formatMoney, type IdeaCardData } from "@foundmill/dugout";
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
  /** "phone": the field stacks and the card sits under it (the hero from 390 px). */
  layout?: "desktop" | "phone";
  /** Told when a card lands (or a held card is found): the hero changes its headline. */
  onLanded?: (landed: IdeaBoxLanded | null) => void;
}

const INCLUDED = formatMoney({ amountMinor: includedCreditsMinor("free"), currency: CREDITS_CURRENCY }, { locale: "en-US" });

/** The words the box prints. */
export const IDEA_BOX_WORDS = {
  label: "Your idea, in a sentence",
  generate: "Shape my idea",
  drafting: "Shaping",
  noIdea: "No idea yet? Say what you are good at, or",
  noIdeaPhone: "No idea yet?",
  surprise: "Surprise me",
  pickInterest: "Pick something you like",
  free: "Your first card is free · no sign-up",
  private: "Your idea stays private until you choose to share it",
  safe: "Nothing moves money or signs in your name without you",
  keepLead: "Sign in and it is saved to your account. From there your team checks it against real sources, drafts the plan, and starts building when you say so.",
  keepEmail: "Continue with email",
  freeLine: `Free to start · ${INCLUDED} of included credits · no card`,
  waits: "Not now? This card waits on this device for 7 days.",
  yourWords: "Your words",
  again: "This is the card this device already holds. Sign in to keep it and draft more with your team.",
  unlockResearch: "A researched version of this card, with sources",
  unlockCompare: "More directions to compare side by side",
  unlockTeam: "A team of agents to build it",
} as const;

/** Where "Keep this card" goes: sign-in, then /start, which claims the card (the claim token for another device). */
export function keepHref(claim: string | null): string {
  const start = claim ? `/start?${IDEA_CLAIM_PARAM}=${encodeURIComponent(claim)}` : "/start";
  return `/login?${NEXT_PARAM}=${encodeURIComponent(start)}`;
}

type Landed = Extract<IdeaBoxEvent, { type: "card" }>;

export function IdeaBox({ layout = "desktop", onLanded }: IdeaBoxProps) {
  const env = publicEnv();
  const phone = layout === "phone";
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

  return (
    <div className={cn("flex w-full flex-col items-center", phone ? "gap-3.5" : "gap-3.5")} data-idea-box="" data-phase={phase}>
      {showField ? (
        <form onSubmit={submit} className={cn("idea-field", phone && "idea-field-stack", phone ? "w-full" : "max-w-[47.5rem]")} aria-label="Your idea" noValidate>
          <label htmlFor={inputId} className="sr-only">
            {IDEA_BOX_WORDS.label}
          </label>
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
              placeholder={focused ? "Describe your idea in a sentence" : ""}
              className={cn("idea-input min-h-12 py-3", phone ? "px-2" : "overflow-hidden whitespace-nowrap")}
              data-testid="idea-input"
            />
            {/* The typing placeholder: decorative, under the empty field until the visitor clicks in. */}
            {!focused && value === "" && !drafting ? (
              <span aria-hidden className={cn("pointer-events-none absolute inset-y-0 left-0 flex items-center text-[17px] leading-6 tracking-[-0.01em] text-tertiary", phone ? "px-2" : "truncate")} data-testid="idea-placeholder">
                {placeholder}
                <span className="idea-caret" />
              </span>
            ) : null}
          </div>
          <button type="submit" className={cn("idea-gen", phone && "w-full")} disabled={drafting} data-testid="idea-generate">
            <span className="idea-gen-core">
              <Icon icon={Fan} size={18} className={drafting ? "motion-safe:animate-spin" : undefined} />
            </span>
            {drafting ? IDEA_BOX_WORDS.drafting : IDEA_BOX_WORDS.generate}
            {!phone && !drafting ? (
              <span className="idea-kbd" aria-hidden>
                Enter
              </span>
            ) : null}
          </button>
          {/* The invisible Turnstile widget renders here. */}
          <div ref={widget} className="absolute" aria-hidden />
        </form>
      ) : (
        <div className={cn("idea-field idea-field-quiet", phone ? "w-full idea-field-stack" : "max-w-[47.5rem]")} aria-label="Your idea">
          <span className="idea-input truncate py-3" data-testid="idea-landed-words">
            {landed?.prompt || landed?.interest || ""}
          </span>
          <span className="t-small mr-3 inline-flex items-center gap-1.5 rounded-xs px-2 py-1 text-accent">{landed?.prompt ? IDEA_BOX_WORDS.yourWords : landed?.interest}</span>
        </div>
      )}

      {error ? (
        <p id={errorId} role="alert" className="t-body text-warn" data-testid="idea-error">
          {error}
        </p>
      ) : null}

      {phase === "rest" ? (
        <>
          <div className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-small text-tertiary", phone && "w-full")}>
            <span>{phone ? IDEA_BOX_WORDS.noIdeaPhone : IDEA_BOX_WORDS.noIdea}</span>
            <Button
              variant="default"
              size="sm"
              icon={Dices}
              className={phone ? "min-h-tap" : undefined}
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
            <div className="flex max-w-[47.5rem] flex-col items-center gap-2" data-testid="idea-interests">
              <span className="t-label text-secondary">{IDEA_BOX_WORDS.pickInterest}</span>
              <ul className="flex flex-wrap justify-center gap-2">
                {IDEA_BOX_INTERESTS.map((interest) => (
                  <li key={interest}>
                    <Button variant="default" size="sm" className={phone ? "min-h-tap" : undefined} onClick={() => void draft({ prompt: "", interest })}>
                      {interest}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ul className={cn("flex flex-wrap justify-center gap-x-6 gap-y-2 text-small text-secondary", phone && "flex-col items-center")}>
            <Assure icon={Medal}>{IDEA_BOX_WORDS.free}</Assure>
            <Assure icon={Lock}>{IDEA_BOX_WORDS.private}</Assure>
            {!phone ? <Assure icon={ShieldCheck}>{IDEA_BOX_WORDS.safe}</Assure> : null}
          </ul>
        </>
      ) : null}

      {phase !== "rest" ? (
        <div className={cn("mt-3 flex w-full gap-10", phone ? "flex-col items-center gap-6" : "max-w-[47.5rem] items-start")} data-testid="idea-result">
          <IdeaCard card={card} drafting={drafting} justIn={phase === "landed" && !landed?.again} sample={landed?.sample ?? false} className={phone ? "max-w-full" : "shrink-0"} />
          {phase === "landed" ? (
            <div className="flex min-w-0 flex-1 flex-col gap-5 pt-1 text-left" data-testid="idea-keep">
              {landed?.again ? <p className="t-small text-secondary">{IDEA_BOX_WORDS.again}</p> : null}
              <p className="t-reading text-prose">{IDEA_BOX_WORDS.keepLead}</p>
              <div className="flex flex-col gap-2.5">
                {googleSignInEnabled(env) ? <GoogleSignInButton onClick={() => void continueWithGoogle()} loading={googleBusy} /> : null}
                <Button asChild variant="glass" size="lg" icon={Mail} iconRight={ArrowRight} className="min-h-tap w-full">
                  <a href={keep} data-testid="idea-keep-email">
                    {IDEA_BOX_WORDS.keepEmail}
                  </a>
                </Button>
                <p className="t-small text-center text-tertiary">{IDEA_BOX_WORDS.freeLine}</p>
              </div>
              <ul className="flex flex-col gap-2.5 border-t border-line pt-5 text-body text-secondary">
                <Unlock icon={Search}>{IDEA_BOX_WORDS.unlockResearch}</Unlock>
                <Unlock icon={Columns2}>{IDEA_BOX_WORDS.unlockCompare}</Unlock>
                <Unlock icon={Users}>{IDEA_BOX_WORDS.unlockTeam}</Unlock>
              </ul>
              <p className="t-small text-tertiary">{IDEA_BOX_WORDS.waits}</p>
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

function Assure({ icon, children }: { icon: typeof Medal; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <Icon icon={icon} size="inline" className="text-good" />
      {children}
    </li>
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

