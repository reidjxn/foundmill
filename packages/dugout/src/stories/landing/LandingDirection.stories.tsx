import type { Meta, StoryObj } from "@storybook/react-vite";
import { Fan, Lock, Medal, ShieldCheck, Dices } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Icon } from "../../components/foundation/Icon";
import { Wordmark } from "../../components/foundation/Wordmark";
import { IdeaCard, type IdeaCardData } from "../../components/public/IdeaCard";
import { PersonPage } from "../../components/public/PersonPage";

/**
 * A static mock of the landing page's direction (docs/holistic-plan/landing/DIRECTION.md): the hero and sections 2 and 3,
 * so the founder can see the direction before it is built. Nothing here is product code: the page itself is built in
 * apps/web from the design-system pieces pull request 2 adds. The `ld-*` rules below are the landing tokens and
 * utilities proposed in DIRECTION §7; pull request 2 moves them into tokens.css and a landing stylesheet.
 */
const PROPOSED = `
.ld { --fs-landing-h1: clamp(36px, 4.6vw + 18px, 72px); --fs-landing-h2: clamp(26px, 1.8vw + 19px, 40px);
  --fs-landing-lede: clamp(17px, 0.3vw + 16px, 19px); --landing-section-y: clamp(56px, 7vw, 112px);
  container-type: inline-size; background: var(--canvas); color: var(--text-1); font-size: 16px; line-height: 26px; }
.ld-col { margin-inline: auto; width: 100%; max-width: 1120px; padding-inline: 16px; }
.ld-measure { max-width: 640px; }
.ld-h1 { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-landing-h1); line-height: 1.04; text-wrap: balance; letter-spacing: -0.01em; }
.ld-h2 { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-landing-h2); line-height: 1.12; text-wrap: balance; }
.ld-lede { font-size: var(--fs-landing-lede); line-height: 1.55; color: var(--text-2); text-wrap: pretty; }
.ld-small { font-size: 14px; line-height: 20px; }
.ld-section { padding-block: var(--landing-section-y); border-top: 1px solid var(--line-faint); }
.ld-light { background: radial-gradient(ellipse 60% 360px at 50% 0, color-mix(in oklab, var(--kit-aura) 16%, transparent), transparent 70%); }
.ld-label { font-weight: 500; font-size: 16px; line-height: 24px; color: var(--text-1); }
.ld-field { display: flex; flex-direction: column; gap: 10px; }
.ld-input { width: 100%; min-height: 56px; padding: 14px 18px; border-radius: 10px; font-size: 17px; line-height: 24px; color: var(--text-3);
  background: var(--surface-1); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--white) 34%, transparent); }
.ld-gen-filled { display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 52px; padding: 0 20px; border-radius: 10px;
  font-weight: 600; font-size: 16px; color: var(--kit-on-primary); background: var(--kit-primary); box-shadow: inset 0 0 0 1px var(--kit-hi); }
.ld-grid { display: grid; gap: 40px; }
@container (min-width: 640px) { .ld-col { padding-inline: 32px; } .ld-field { flex-direction: row; } .ld-field .idea-gen, .ld-field .ld-gen-filled { height: 56px; } }
@container (min-width: 1024px) { .ld-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 420px); align-items: start; gap: 64px; } }
.ld-frame { position: relative; border-radius: 14px; padding: 12px; background: var(--rail); box-shadow: inset 0 0 0 1px var(--line); }
.ld-frame-chip { position: absolute; top: -11px; left: 16px; padding: 0 8px; height: 22px; display: inline-flex; align-items: center; border-radius: 6px;
  font-size: 12px; font-weight: 500; color: var(--text-2); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line-strong); }
.ld-frame-screen { max-height: 560px; overflow: hidden; border-radius: 8px; }
`;

const KEYS = ["market_pull", "market_size", "competition", "speed_to_first_customer", "capital_intensity", "agent_executability", "founder_fit", "defensibility", "regulatory_load", "distribution_clarity"];
const VALUES = [14, 7, 9, 17, 18, 13, 10, 6, 18, 15];
const EVIDENCE = "Students at one college already pay for laundry and shoe care nearby; a first few cleans can be done by hand.";
const exampleCard: IdeaCardData = {
  name: "Sole Revival",
  pitch: "Sneaker cleaning and restoring for students at one college, picked up and dropped off on campus.",
  archetype: "services",
  stars_current: 3,
  stars_potential: 4,
  attributes: KEYS.map((key, i) => ({ key, value: VALUES[i]!, evidence: EVIDENCE })),
};

type ButtonLook = "recorded" | "filled";

function Assure({ icon, children }: { icon: typeof Medal; children: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon icon={icon} size="default" className="mt-0.5 shrink-0 text-status-good" />
      <span>{children}</span>
    </li>
  );
}

function Frame({ children, label = "Example" }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="ld-frame">
      <span className="ld-frame-chip">{label}</span>
      <div className="ld-frame-screen">{children}</div>
    </div>
  );
}

function Mock({ look }: { look: ButtonLook }) {
  return (
    <div className="ld" data-testid="landing-direction">
      <style>{PROPOSED}</style>
      <header className="border-b border-line">
        <div className="ld-col flex h-16 items-center gap-3">
          <Wordmark height={16} label={APP_NAME} />
          <span className="flex-1" />
          <span className="inline-flex min-h-tap items-center px-3 font-medium text-secondary">Sign in</span>
        </div>
      </header>

      <section className="ld-light" aria-labelledby="ld-hero">
        <div className="ld-col flex flex-col items-center gap-6 pb-16 pt-12 text-center">
          <h1 id="ld-hero" className="ld-h1 max-w-4xl">
            Start something of your own, with a team of AI agents.
          </h1>
          <p className="ld-lede ld-measure">
            Type your idea in one sentence. Your team gives it a name, a pitch and ten honest ratings, free and before you sign up. Keep it, and once your place opens the team drafts a page for it and plans what comes next.
          </p>
          <form className="ld-measure flex w-full flex-col gap-2 text-left" onSubmit={(e) => e.preventDefault()}>
            <label htmlFor="ld-idea" className="ld-label">
              What do you want to make?
            </label>
            <div className="ld-field">
              <div id="ld-idea" className="ld-input flex-1" role="textbox" aria-label="What do you want to make?" tabIndex={0}>
                Sneaker cleaning for people at my school
              </div>
              {look === "recorded" ? (
                <button type="submit" className="idea-gen min-h-tap px-4">
                  <span className="idea-gen-core">
                    <Icon icon={Fan} size={18} />
                  </span>
                  Shape my idea
                </button>
              ) : (
                <button type="submit" className="ld-gen-filled">
                  <Icon icon={Fan} size={18} />
                  Shape my idea
                </button>
              )}
            </div>
          </form>
          <div className="ld-small flex flex-wrap items-center justify-center gap-3 text-secondary">
            No idea yet?
            <span className="inline-flex min-h-tap items-center gap-2 rounded-sm px-3 text-primary ring-1 ring-line-strong">
              <Icon icon={Dices} size="default" />
              Surprise me
            </span>
          </div>
          <ul className="ld-small ld-measure flex flex-col gap-2.5 text-left text-secondary @[640px]:items-center">
            <Assure icon={Medal}>Your first card is free and needs no sign-up</Assure>
            <Assure icon={Lock}>Your idea stays private until you choose to share it</Assure>
            <Assure icon={ShieldCheck}>Nothing spends money or signs in your name without you</Assure>
          </ul>
          <p className="ld-small ld-measure text-tertiary">{APP_NAME} lets new people in a few at a time. Signing in puts you on the list and keeps your card for 90 days.</p>
        </div>
      </section>

      <section className="ld-section" aria-labelledby="ld-card">
        <div className="ld-col ld-grid">
          <div className="flex flex-col gap-5 ld-measure">
            <h2 id="ld-card" className="ld-h2">
              What comes back
            </h2>
            <p className="ld-lede">One card for your idea, and it is yours to keep.</p>
            <ul className="flex flex-col gap-4 text-secondary">
              <li>
                <strong className="font-semibold text-primary">A name and a one-line pitch</strong>, written from your words.
              </li>
              <li>
                <strong className="font-semibold text-primary">Ten ratings out of 20</strong>, each with the reason behind it. Founder fit waits until you have answered a few questions about yourself.
              </li>
              <li>
                <strong className="font-semibold text-primary">The one thing that would raise it most</strong>, so you know where to start.
              </li>
            </ul>
          </div>
          <Frame>
            <IdeaCard card={exampleCard} className="max-w-full" />
          </Frame>
        </div>
      </section>

      <section className="ld-section" aria-labelledby="ld-people">
        <div className="ld-col ld-grid">
          <div className="flex flex-col gap-5 ld-measure">
            <h2 id="ld-people" className="ld-h2">
              On your own, or with people
            </h2>
            <p className="ld-lede">You can build all of it by yourself. Your team of agents covers the work, and nothing waits on a second person.</p>
            <p className="text-secondary">If you want people to build it with, they are one step away.</p>
            <ul className="flex flex-col gap-4 text-secondary">
              <li>
                <strong className="font-semibold text-primary">Invite anyone.</strong> Send an invitation link. They join your project as a cofounder, with the same standing as you, or as a collaborator who helps with the product and customers and sees nothing of the money or settings.
              </li>
              <li>
                <strong className="font-semibold text-primary">People are free.</strong> Add as many cofounders and collaborators as you like, on every plan.
              </li>
              <li>
                <strong className="font-semibold text-primary">A page of your own.</strong> At foundmill.com/u/your-name, say what you are good at and, if you like, that you are open to building with people, looking for a cofounder or looking to join a project.
              </li>
            </ul>
          </div>
          <Frame>
            <PersonPage
              variant="preview"
              name="Ama Mensah"
              headline="Shoe care, campus pickups, good with a sewing machine"
              place="Austin, TX"
              lookingFor="open_to_people"
              strengths={["Sneaker restoring", "Short videos", "Talking to customers"]}
              projects={[{ slug: "sole-revival", name: "Sole Revival", pitch: "Sneaker cleaning for students at one college.", href: "#" }]}
            />
          </Frame>
        </div>
      </section>
    </div>
  );
}

const meta = {
  title: "Landing/Direction",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

/** The founder's recorded button (2026-11-13): dark with a white 1 px outline. Built by default. */
export const HeroRecordedButton: Story = { name: "Hero, recorded button", render: () => <Mock look="recorded" /> };
/** The alternative s1 recommends: a flat filled primary, the only filled thing on the page. */
export const HeroFilledButton: Story = { name: "Hero, filled button", render: () => <Mock look="filled" /> };
