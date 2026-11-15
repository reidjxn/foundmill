"use client";
/**
 * The first-timer's hero (DESIGN §9a; DIRECTION §4 "1. Hero"): the h1, the lede, the idea box, and the line about the
 * door while sign-up is closed. When a card lands the h1 becomes "<name> is yours to keep." and the page is told
 * (`data-landed` on the landing root), so section 2's example card steps aside for the visitor's own.
 */
import { useEffect, useState } from "react";
import { IdeaBox, type IdeaBoxLanded } from "./idea-box/IdeaBox";
import { LANDING_WORDS } from "./words";

const W = LANDING_WORDS.hero;

export function LandingHero({ signupOpen }: { signupOpen: boolean }) {
  const [landed, setLanded] = useState<IdeaBoxLanded | null>(null);
  useEffect(() => {
    document.querySelector("[data-landing]")?.toggleAttribute("data-landed", landed !== null);
  }, [landed]);
  return (
    <section id="hero" aria-labelledby="hero-title" className="pb-14 pt-10 @page-wide:pb-20 @page-wide:pt-16">
      <div className="landing-col flex flex-col items-center gap-6 @page-wide:text-center">
        <div className="flex flex-col gap-5 motion-safe:animate-rise-in @page-wide:items-center">
          <h1 id="hero-title" className="t-landing-h1 max-w-4xl text-primary">
            {landed ? W.landedTitle(landed.name) : W.title}
          </h1>
          {!landed ? (
            <p className="t-landing-lede landing-measure" data-testid="hero-lede">
              {W.lede} {signupOpen ? W.ledeOpen : W.ledeClosed}
            </p>
          ) : null}
        </div>
        <div className="landing-measure w-full motion-safe:animate-rise-in">
          <IdeaBox onLanded={setLanded} />
        </div>
        {!signupOpen ? (
          <p className="t-landing-small landing-measure text-secondary" data-testid="hero-door">
            {W.door}
          </p>
        ) : null}
      </div>
    </section>
  );
}
