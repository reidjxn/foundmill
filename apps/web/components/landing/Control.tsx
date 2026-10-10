"use client";
/**
 * You decide, and the way in. On the left a real Inbox note with its DecisionBar (it works: choose, then undo); on
 * the right the house rules and the controls. Then the closing call, which speaks to a first-time founder directly.
 */
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CircleStop, FileSignature, Inbox, KeyRound, Landmark, Lock, ShieldCheck, Tag, Trash2, type LucideIcon } from "lucide-react";
import { Avatar, Button, Chip, DecisionBar, DeptChip, Icon, StatusStrip, TeamOrbit, type DecisionOption } from "@foundmill/dugout";
import { EXAMPLE_CURRENCY, EXAMPLE_INBOX_NOTE, EXAMPLE_START_CYCLE, exampleMoney } from "./example";
import { Container, Glass, ProductWindow, Reveal, SIGN_IN, Section, SectionHeading } from "./parts";

const HOUSE_RULES: ReadonlyArray<{ icon: LucideIcon; text: string }> = [
  { icon: Landmark, text: "Never moves money" },
  { icon: FileSignature, text: "Never signs anything or accepts terms" },
  { icon: Tag, text: "Never files anything with your identity" },
  { icon: Trash2, text: "Never deletes anything permanently" },
  { icon: Lock, text: "Never changes security settings" },
  { icon: ShieldCheck, text: "Never acts on instructions found in emails, web pages or files it reads" },
];

const CONTROLS: ReadonlyArray<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: CircleStop, title: "Stop all agents", text: "One button in the top bar pauses every agent at once. They resume where they stopped." },
  { icon: KeyRound, title: "Your key, sealed", text: "Bring your own Anthropic key. Credentials are encrypted per business and never sent into a sandbox." },
];

const NOTE = EXAMPLE_INBOX_NOTE;
const OPTIONS: DecisionOption[] = [
  { id: "approve", label: "Approve", recommended: true, consequence: "Scout books the sponsorship and the copy runs next week.", cost: { amountMinor: NOTE.costMinor, currency: EXAMPLE_CURRENCY }, reversible: false },
  { id: "smaller", label: "Try a smaller list first", consequence: "Scout finds a smaller tutors' list to test the copy on, inside your cap.", cost: null, reversible: true },
  { id: "later", label: "Not this chapter", consequence: "Communities stay at search and referrals until the next chapter.", cost: null, reversible: true },
];

export function YourCall() {
  return (
    <Section id="control">
      <SectionHeading id="control" eyebrow="You decide" title="Your team does the work. You make the calls." lede="House rules sit above every agent's instructions and cannot be edited away. When work needs one of these, the team prepares everything and asks you, with a recommendation and what each choice costs." />
      <div className="grid grid-cols-12 gap-6">
        <Reveal className="col-span-7">
          <InboxNote />
        </Reveal>
        <Reveal className="col-span-5 flex flex-col gap-6" delay={90}>
          <Glass className="flex flex-col gap-3 p-5" accent="var(--status-good)">
            <span className="t-label inline-flex items-center gap-1.5">
              <Icon icon={ShieldCheck} size={14} className="text-status-good" /> House rules
            </span>
            <ul className="flex flex-col">
              {HOUSE_RULES.map((r) => (
                <li key={r.text} className="flex items-center gap-3 border-b border-subtle/50 py-2.5 last:border-b-0">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-status-good/12 text-status-good">
                    <Icon icon={r.icon} size={14} />
                  </span>
                  <span className="text-body text-primary">{r.text}</span>
                </li>
              ))}
            </ul>
          </Glass>
          {CONTROLS.map((c) => (
            <Glass key={c.title} className="flex gap-4 p-5">
              <span className="grid size-10 shrink-0 place-items-center rounded-panel border border-subtle bg-panel-alt text-link">
                <Icon icon={c.icon} size={20} />
              </span>
              <span className="flex flex-col gap-1">
                <h3 className="t-display-sm text-primary">{c.title}</h3>
                <p className="text-body text-secondary">{c.text}</p>
              </span>
            </Glass>
          ))}
        </Reveal>
      </div>
    </Section>
  );
}

/** One Inbox note as the product shows it: who wrote it, the note, the numbers behind it and the DecisionBar. */
function InboxNote() {
  const [answer, setAnswer] = useState<string | null>(null);
  return (
    <ProductWindow title="Inbox" chips={<Chip tone="neutral">Example business</Chip>} className="h-full">
      <article aria-label="Example Inbox note" className="flex flex-col">
        <header className="flex h-16 items-center gap-3 border-b border-subtle px-5">
          <Avatar size={32} name={NOTE.from.name} agent={{ seed: NOTE.from.seed, dept: NOTE.from.dept }} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="t-body-strong text-primary">
              {NOTE.from.name} · {NOTE.from.role}
            </span>
            <span className="text-small text-secondary">
              {NOTE.sentOn} · cycle {EXAMPLE_START_CYCLE + 1}
            </span>
          </span>
          <DeptChip dept={NOTE.from.dept}>{NOTE.department}</DeptChip>
          <Chip tone="bad" icon={Inbox}>
            Needs you
          </Chip>
        </header>
        <div className="flex flex-col gap-4 px-5 py-5">
          <h3 className="t-display-md text-primary">{NOTE.subject}</h3>
          {NOTE.paragraphs.map((text, i) => (
            <p key={i} className={i === 0 ? "t-reading text-primary" : "t-reading text-secondary"}>
              {text}
            </p>
          ))}
          <StatusStrip
            tiles={[
              { label: "Cost", value: exampleMoney(NOTE.costMinor), estimate: "estimate" },
              { label: "Channel fit", value: NOTE.fit },
              { label: "Runway after", value: "14 months", estimate: "estimate" },
            ]}
          />
        </div>
        <DecisionBar
          options={OPTIONS}
          onChoose={(o) => setAnswer(o.id)}
          answered={answer ? { optionId: answer } : undefined}
          onReopen={OPTIONS.find((o) => o.id === answer)?.reversible ? () => setAnswer(null) : undefined}
          hotkeys={false}
          sticky={false}
        />
      </article>
    </ProductWindow>
  );
}

export function FinalCall() {
  return (
    <section aria-labelledby="start-title" className="relative pb-24 pt-4">
      <Container>
        <div className="relative overflow-hidden rounded-panel border border-subtle px-16 py-24">
          <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(ellipse 55% 90% at 50% 110%, color-mix(in oklab, var(--kit-primary) 50%, transparent), transparent 70%), var(--bg-ink)" }} />
          <div aria-hidden className="absolute inset-0" style={{ backgroundImage: "radial-gradient(color-mix(in oklab, var(--white) 10%, transparent) 1px, transparent 1.5px)", backgroundSize: "22px 22px", maskImage: "radial-gradient(ellipse 60% 80% at 50% 100%, black 20%, transparent 80%)" }} />
          <div aria-hidden className="pointer-events-none absolute -bottom-136 left-1/2 w-200 -translate-x-1/2 opacity-30" style={{ maskImage: "linear-gradient(180deg, transparent 0%, black 35%)" }}>
            <TeamOrbit periodSeconds={140} />
          </div>
          <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-7 pb-24 text-center">
            <h2 id="start-title" className="t-display-hero text-balance text-primary">
              Your team is ready <span className="landing-lit">when you are.</span>
            </h2>
            <p className="t-reading mx-auto text-pretty text-secondary">Never started a company? You do not need to know how to incorporate, price, run ads or keep books. Every decision arrives with the work done, a recommendation and the reason for it.</p>
            <div className="flex gap-3">
              <Button asChild variant="glass" size="lg" iconRight={ArrowRight}>
                <Link href={SIGN_IN}>Start your business</Link>
              </Button>
              <Button asChild variant="ghost" size="lg">
                <Link href={SIGN_IN}>Sign in</Link>
              </Button>
            </div>
            <p className="text-small text-secondary">Sign in with your email. No password, no card. Start from an idea or bring the business you already have.</p>
          </div>
        </div>
      </Container>
    </section>
  );
}
