"use client";
/**
 * The landing page's hero (DESIGN §9a): the variant's h1 and lede, the idea box, and the line about the door while
 * sign-up is closed, with a real example beside them from 1024 px (`example`, rendered on the server). When the
 * visitor's own idea lands the h1 becomes "<name> is yours to keep." and the page is told (`data-landed` on the
 * landing root), so the example steps aside for it.
 */
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@foundmill/dugout";
import { IdeaBox, type IdeaBoxLanded } from "./idea-box/IdeaBox";
import { LANDING_WORDS, type VariantWords } from "./words";

const W = LANDING_WORDS.hero;

export interface LandingHeroProps {
  signupOpen: boolean;
  words: Pick<VariantWords, "title" | "lede" | "label" | "ideas" | "surpriseOpen">;
  /** The example result beside the box (under it before 1024 px). */
  example: ReactNode;
}

export function LandingHero({ signupOpen, words, example }: LandingHeroProps) {
  const [landed, setLanded] = useState<IdeaBoxLanded | null>(null);
  useEffect(() => {
    document.querySelector("[data-landing]")?.toggleAttribute("data-landed", landed !== null);
  }, [landed]);
  return (
    <section id="hero" aria-labelledby="hero-title" className="world-day landing-daylight pb-16 pt-10 @page-wide:pb-20 @page-wide:pt-16">
      {/* Landed: the example steps aside and the card with its choices takes the whole column (founder, 2026-11-16). */}
      <div className={cn("landing-col", !landed && "landing-hero-grid")}>
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-5 motion-safe:animate-rise-in">
            <h1 id="hero-title" className="t-landing-h1 text-primary">
              {landed ? W.landedTitle(landed.name) : words.title}
            </h1>
            {!landed ? (
              <p className="t-landing-lede landing-measure" data-testid="hero-lede">
                {words.lede} {signupOpen ? W.ledeOpen : W.ledeClosed}
              </p>
            ) : null}
          </div>
          <div className={cn("w-full motion-safe:animate-rise-in", !landed && "landing-measure")}>
            <IdeaBox onLanded={setLanded} label={words.label} ideas={words.ideas} surpriseOpen={words.surpriseOpen} align="start" />
          </div>
          {!signupOpen ? (
            <p className="t-landing-small landing-measure text-secondary" data-testid="hero-door">
              {W.door}
            </p>
          ) : null}
        </div>
        {example}
      </div>
    </section>
  );
}
