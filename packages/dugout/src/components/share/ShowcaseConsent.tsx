"use client";
/**
 * A founder's own ask about a showcase video (docs/THESIS_REVIEW.md §13 item 15; 0105): exactly what would be posted
 * (the video, the post's words, the link and the networks), the sentence that a posted video cannot be pulled back,
 * and the founder's own answer. Nothing about any other founder's answer is shown, because nothing about it is known
 * here. It reads from 390 px (Needs you is outer product): one column, 44 px controls, nothing wider than the screen.
 *
 * Presentational: the web wires `onAnswer` and `onWithdraw` to `showcase.answer` and `showcase.withdrawMine`.
 */
import { useId } from "react";
import { Link2, Play } from "lucide-react";
import type { PostNetwork } from "@foundmill/shared/post-draft";
import { showcaseWords, type ShowcaseAnswer, type ShowcaseRequestState } from "@foundmill/shared/showcase";
import { Button } from "../foundation/Button";

/** What the note shows. Built from `showcase.ask`. */
export interface ShowcaseConsentView {
  projectName: string;
  postText: string;
  link: string;
  networks: readonly PostNetwork[];
  /** Where each clip plays from, in order; empty once the media was deleted. */
  clips: readonly { url: string | null; caption: string }[];
  answer: ShowcaseAnswer | null;
  withdrawn: boolean;
  state: ShowcaseRequestState;
  /** "Nov 28, 2026": when the ask closes. */
  expiresOn: string;
  canAnswer: boolean;
  canWithdraw: boolean;
}

export interface ShowcaseConsentProps {
  view: ShowcaseConsentView;
  appName: string;
  onAnswer?: (answer: ShowcaseAnswer) => void;
  onWithdraw?: () => void;
  /** An answer is on its way: the controls wait. */
  busy?: boolean;
}

/** A network by its plain word: no logos, no brand colors. */
const NETWORK_WORDS: Readonly<Record<string, string>> = { x: "X", linkedin: "LinkedIn", facebook: "Facebook", threads: "Threads", reddit: "Reddit", bluesky: "Bluesky", instagram: "Instagram", tiktok: "TikTok" };

export function ShowcaseConsent({ view, appName, onAnswer, onWithdraw, busy = false }: ShowcaseConsentProps) {
  const w = showcaseWords(appName);
  const headingId = useId();
  const recallId = useId();
  const playable = view.clips.filter((c) => !!c.url);
  const mine = view.withdrawn ? null : view.answer === "yes" ? w.answeredYes : view.answer === "no" ? w.answeredNo : null;
  return (
    <section aria-labelledby={headingId} className="flex w-full min-w-0 max-w-full flex-col gap-4" data-testid="showcase-consent" data-state={view.state}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="t-title text-primary text-pretty">
          {w.heading}
        </h2>
        <p className="text-body text-secondary text-pretty">{w.intro}</p>
      </div>

      <div className="flex flex-col gap-2" data-testid="showcase-video">
        <h3 className="t-label text-secondary">{w.videoLabel}</h3>
        {playable.length ? (
          <ol className="flex flex-col gap-3">
            {playable.map((clip, i) => (
              <li key={`${clip.url}-${i}`} className="flex flex-col gap-1">
                <video className="aspect-[9/16] w-full max-w-[22.5rem] rounded-md bg-panel-alt object-cover" src={clip.url!} controls playsInline preload="metadata" aria-label={clip.caption} />
                <span className="text-small text-secondary">{clip.caption}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="flex items-center gap-1.5 text-small text-secondary">
            <Play aria-hidden size={14} />
            The video is no longer available.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="t-label text-secondary">{w.postLabel}</h3>
        <p className="text-body text-primary text-pretty break-words" data-testid="showcase-post">
          {view.postText}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="t-label text-secondary">{w.linkLabel}</h3>
        <a className="inline-flex min-h-tap min-w-0 items-center gap-1.5 break-all text-small text-accent underline-offset-2 hover:underline" href={view.link} target="_blank" rel="noopener noreferrer" data-testid="showcase-link">
          <Link2 aria-hidden size={14} className="shrink-0" />
          <span className="min-w-0 break-all">{view.link}</span>
        </a>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="t-label text-secondary">{w.networksLabel}</h3>
        <p className="text-small text-primary" data-testid="showcase-networks">
          {view.networks.map((n) => NETWORK_WORDS[n] ?? n).join(", ")}
        </p>
      </div>

      <p id={recallId} className="rounded-md border border-line-faint p-3 text-body text-primary text-pretty" data-testid="showcase-recall">
        {w.recall}
      </p>
      <p className="text-small text-secondary text-pretty">{w.everyone}</p>

      {view.canAnswer ? (
        <div className="flex flex-wrap gap-2" data-testid="showcase-answer">
          <Button variant="primary" size="lg" className="min-h-tap" aria-describedby={recallId} disabled={busy} onClick={() => onAnswer?.("yes")}>
            {w.yes}
          </Button>
          <Button variant="default" size="lg" className="min-h-tap" disabled={busy} onClick={() => onAnswer?.("no")}>
            {w.no}
          </Button>
        </div>
      ) : null}

      {mine ? (
        <p className="text-small text-secondary" data-testid="showcase-mine">
          {mine}
        </p>
      ) : null}
      {view.canWithdraw ? (
        <div>
          <Button variant="default" size="lg" className="min-h-tap" disabled={busy} onClick={() => onWithdraw?.()} data-testid="showcase-withdraw">
            {w.withdraw}
          </Button>
        </div>
      ) : null}
      <p className="text-small text-secondary" data-testid="showcase-state">
        {view.state === "asking" && view.canAnswer ? w.expires(view.expiresOn) : w.states[view.state]}
      </p>
    </section>
  );
}
