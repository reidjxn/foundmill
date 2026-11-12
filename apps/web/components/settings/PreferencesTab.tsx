"use client";
/**
 * Settings › Preferences (founder, 2026-10-11; guidance added 2026-10-20, docs/UX_AUDIT_AND_PLAN.md §6.3): the signed-in
 * person's own choices, the same in every business they open and on every signed-in screen; nobody else's view changes.
 *
 * - The date and time format: two sets of radio cards (the design system's DateFormatPicker) with live examples of today
 *   in each format. A choice saves at once (`founder.preferences.update` through the DateFormatHost, which shows it
 *   everywhere before the answer and rolls back if the save fails) and a toast confirms it in the new format. Relative
 *   times and dates written inside agent notes are not reformatted, and the help line says so.
 * - Guidance: "Explain things as I go" (the guided layer's one switch), the text size, and two ghost buttons that put the
 *   tutoring back to the first day ("Show the first-week checklist again", "Replay the tour"; both are one reset, so
 *   each is off when it has nothing to undo). They save through the GuidanceHost the same way, with a toast. An InfoTip
 *   beside the switch says what guidance changes (shown in both states: it is information about the switch itself), and
 *   a reassurance line under it says the choice can be switched any time (tutoring, so it hides with guidance off).
 *
 * - Agents: the "Anthropomorphic agents" switch (a first name and an AI-generated picture for every agent, with the
 *   position always beside the name; off shows agents by role, exactly as before) and, while it is on, the Style radio
 *   cards (Humans, 3D cartoon humans, 2D cartoon humans and animals, Fantasy). Both save through the same host at once.
 * - Builder view (0073, founder 2026-11-08): one switch that shows how the platform runs the team (round numbers, tokens,
 *   live screens, test counts, the technical tabs and columns, ratings). Off by default; saves through the same host.
 * - Email (packages 1.5 and 5.1): "Email me when something has waited a day for my answer", on by default; the link in
 *   every such email turns the same switch off.
 *
 * Open to every member, whatever their role: it changes nothing of the business.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, UserRound } from "lucide-react";
import { useCallback, useState } from "react";
import {
  AgentStylePicker,
  Button,
  Chip,
  DATE_FORMAT_LABELS,
  DATE_FORMAT_SAMPLE,
  DateFormatPicker,
  InfoTip,
  Label,
  ReassuranceLine,
  SegmentedControl,
  Switch,
  Term,
  TIME_FORMAT_LABELS,
  bindFormatters,
  type DateFormatPrefs,
  type SegmentedOption,
  type TextSize,
  useFormatters,
} from "@foundmill/dugout";
import type { AgentStyle } from "@foundmill/shared/personas";
import { personStateLine } from "@foundmill/shared/person-profile";
import { TEAM_CALL_WORDS } from "@foundmill/shared/team-call";
import { ANTHROPOMORPHIC_EXPLAINER, anthropomorphicSavedLine } from "@/lib/anthropomorphic";
import { useClientNow } from "@/lib/today";
import { useDatePreferences } from "@/components/providers/DateFormatHost";
import { agentStyleOf, useGuidancePreferences, type GuidancePatch, type GuidancePrefs } from "@/components/providers/GuidanceHost";
import { builderViewSavedLine } from "@/components/providers/guidance-context";
import { useTRPC } from "@/lib/trpc-react";
import { accountRoutes } from "@/lib/account-routes";
import { LinkButton } from "@/components/new/LinkButton";
import { AccountId } from "./AccountId";
import { EmailNotificationsSection } from "./EmailNotificationsSection";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

/** The one field a choice changed, or null when it changed nothing. */
export function preferenceChange(current: DateFormatPrefs, next: DateFormatPrefs): Partial<DateFormatPrefs> | null {
  if (next.date !== current.date) return { date: next.date };
  if (next.time !== current.time) return { time: next.time };
  return null;
}

/** The toast after a save, written in the new format: "Dates read 7 Oct 2026 and times 15:45, in every business." */
export function savedLine(saved: DateFormatPrefs, now: Date): { title: string; description: string } {
  const f = bindFormatters(saved);
  return {
    title: `${DATE_FORMAT_LABELS[saved.date]} dates, ${TIME_FORMAT_LABELS[saved.time]} times`,
    description: `Dates read ${f.formatDate(now)} and times ${f.formatTime(now)}, in every business.`,
  };
}

export const TEXT_SIZE_OPTIONS: readonly SegmentedOption<TextSize>[] = [
  { value: "standard", label: "Standard" },
  { value: "comfortable", label: "Comfortable" },
];

/** What the switch changes, for the InfoTip beside it ("About what guidance changes"). */
export const WHAT_GUIDANCE_CHANGES = "The “Explain this page” button on each screen, the first-week checklist, the coach marks and the dotted underline under defined words. Keyboard caps on buttons show only when it is off; the shortcuts work either way.";

/** The reassurance under the switch; hidden with guidance off, like every reassurance line. */
export const GUIDANCE_REASSURANCE = "You can switch this any time.";

/** Which reset buttons have something to undo: the checklist once it was dismissed; the tour once a tour was done or a page was explained. */
export function resettable(prefs: Pick<GuidancePrefs, "explainersSeen" | "toursDone" | "checklistDismissedAt">): { checklist: boolean; tour: boolean } {
  return {
    checklist: prefs.checklistDismissedAt !== null,
    tour: Object.keys(prefs.toursDone).length > 0 || Object.keys(prefs.explainersSeen).length > 0,
  };
}

export type GuidanceChange = "guidance" | "textSize" | "reset";

/** The toast after a guidance save: the title names the choice, the line says what follows from it. */
export function guidanceSavedLine(saved: Pick<GuidancePrefs, "guidance" | "textSize">, changed: GuidanceChange): { title: string; description: string } {
  if (changed === "guidance") {
    return saved.guidance === "on"
      ? { title: "Guidance on", description: "The Explain this page button, defined words and the first-week checklist show as you go." }
      : { title: "Guidance off", description: "Consequences, provenance and Estimate labels still show. Turn it on again any time from here." };
  }
  if (changed === "textSize") {
    return saved.textSize === "comfortable"
      ? { title: "Comfortable text", description: "Body text reads a little larger, in every business." }
      : { title: "Standard text", description: "Body text is back to its usual size, in every business." };
  }
  return { title: "Starting over", description: "The unread dots on Explain this page, the first-week checklist and the tours show again." };
}

/** The Guidance section (plan §6.3): the switch, the text size and the two resets, each with one line of help. */
export function GuidanceSection() {
  const { prefs, save } = useGuidancePreferences();
  const t = useSettingsToast();
  const [resetting, setResetting] = useState<"checklist" | "tour" | null>(null);
  const can = resettable(prefs);

  const change = useCallback(
    (patch: GuidancePatch, changed: GuidanceChange) =>
      save(patch).then(
        (saved) => {
          const line = guidanceSavedLine(saved, changed);
          t.saved(line.title, line.description);
        },
        (err: unknown) => t.failed(err, "Preference not saved"),
      ),
    [save, t],
  );
  const reset = (which: "checklist" | "tour") => {
    setResetting(which);
    void change({ reset: true }, "reset").finally(() => setResetting(null));
  };

  return (
    <SettingsSection title="Guidance" data-testid="guidance-panel">
      <Hint>
        How much the product explains as you go, in every business you open. Consequences, provenance and <Term id="estimate" always>Estimate</Term> labels always show.
      </Hint>
      <div className="flex items-start gap-3" data-testid="guidance-choice">
        <Switch
          id="guidance-switch"
          checked={prefs.guidance === "on"}
          onCheckedChange={(on) => void change({ guidance: on ? "on" : "off" }, "guidance")}
          aria-describedby="guidance-switch-hint"
          data-testid="guidance-switch"
        />
        <div className="flex flex-col gap-1">
          {/* The tip sits beside the label, never inside it: a button inside a <label> would also toggle the switch. */}
          <div className="flex items-center gap-0.5">
            <Label htmlFor="guidance-switch">Explain things as I go</Label>
            <InfoTip label="what guidance changes" always className="-my-1">
              {WHAT_GUIDANCE_CHANGES}
            </InfoTip>
          </div>
          <p id="guidance-switch-hint" className="text-small text-secondary">
            An “Explain this page” button on each screen, defined words you can hover, the first-week checklist and the tours.
          </p>
          <ReassuranceLine data-testid="guidance-reassurance">{GUIDANCE_REASSURANCE}</ReassuranceLine>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="text-size">Text size</Label>
        <SegmentedControl id="text-size" aria-label="Text size" size="md" options={TEXT_SIZE_OPTIONS} value={prefs.textSize} onValueChange={(size) => void change({ textSize: size }, "textSize")} className="w-fit" data-testid="text-size" />
        <p className="text-small text-secondary">Comfortable makes body text a little larger; nothing on the screen moves.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={can.checklist ? () => reset("checklist") : undefined} aria-disabled={!can.checklist || undefined} loading={resetting === "checklist"} data-testid="show-checklist-again">
            Show the first-week checklist again
          </Button>
          <Button variant="ghost" onClick={can.tour ? () => reset("tour") : undefined} aria-disabled={!can.tour || undefined} loading={resetting === "tour"} data-testid="replay-tour">
            Replay the tour
          </Button>
        </div>
        <p className="text-small text-secondary">Either one puts the unread dots on “Explain this page”, the checklist and the tours back to the first day.</p>
      </div>
    </SettingsSection>
  );
}

export { ANTHROPOMORPHIC_EXPLAINER, anthropomorphicSavedLine };

/**
 * The Agents section: the "Anthropomorphic agents" switch and, while it is on, the style of character (Humans, 3D cartoon
 * humans, 2D cartoon humans and animals, Fantasy). Each choice saves at once through the GuidanceHost like the guidance
 * switch, and the toast names the style. Off is identical to before whatever the style says (the style is kept).
 */
export function AnthropomorphicAgentsSection() {
  const { prefs, save } = useGuidancePreferences();
  const t = useSettingsToast();
  const on = prefs.anthropomorphicAgents === true;
  const style = agentStyleOf(prefs);
  const change = (patch: GuidancePatch) =>
    save(patch).then(
      (saved) => {
        const line = anthropomorphicSavedLine(saved.anthropomorphicAgents === true, agentStyleOf({ agentStyle: saved.agentStyle ?? patch.agentStyle ?? style }));
        t.saved(line.title, line.description);
      },
      (err: unknown) => t.failed(err, "Preference not saved"),
    );
  const chooseStyle = (next: AgentStyle) => {
    if (next !== style) void change({ agentStyle: next });
  };
  return (
    <SettingsSection title="Agents" data-testid="anthropomorphic-panel">
      <div className="flex items-start gap-3" data-testid="anthropomorphic-choice">
        <Switch
          id="anthropomorphic-switch"
          checked={on}
          onCheckedChange={(next) => void change({ anthropomorphicAgents: next })}
          aria-describedby="anthropomorphic-switch-hint"
          data-testid="anthropomorphic-switch"
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="anthropomorphic-switch">Anthropomorphic agents</Label>
          <p id="anthropomorphic-switch-hint" className="text-small text-secondary">
            {ANTHROPOMORPHIC_EXPLAINER}
          </p>
        </div>
      </div>
      {on ? <AgentStylePicker value={style} onChange={chooseStyle} testIdPrefix="agent-style" /> : null}
    </SettingsSection>
  );
}

/** What Builder view shows, under its switch (docs/DESIGN.md "Builder view"). */
export const BUILDER_VIEW_HINT =
  "Shows how the platform runs the team: round numbers, AI usage in tokens, agents' live screens, test counts, finished code changes and previews, and the team's ratings, health and reporting lines. For operators and anyone building software with the team.";

export { builderViewSavedLine };

/** The Builder view section: one switch, saved at once through the GuidanceHost, with a toast. */
export function BuilderViewSection() {
  const { prefs, save } = useGuidancePreferences();
  const t = useSettingsToast();
  const on = prefs.builderView === true;
  const change = (next: boolean) =>
    save({ builderView: next }).then(
      (saved) => {
        const line = builderViewSavedLine(saved.builderView === true);
        t.saved(line.title, line.description);
      },
      (err: unknown) => t.failed(err, "Preference not saved"),
    );
  return (
    <SettingsSection title="Builder view" data-testid="builder-view-panel">
      <div className="flex items-start gap-3" data-testid="builder-view-choice">
        <Switch id="builder-view-switch" checked={on} onCheckedChange={(next) => void change(next)} aria-describedby="builder-view-switch-hint" data-testid="builder-view-switch" />
        <div className="flex flex-col gap-1">
          <Label htmlFor="builder-view-switch">Builder view</Label>
          <p id="builder-view-switch-hint" className="text-small text-secondary">
            {BUILDER_VIEW_HINT}
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * Team call (founder, Nov 12, 2026): one-to-one calls are private to the person who made them by default. One switch,
 * off by default, shares this person's one-to-one calls (past and future) with the project; team calls are always the
 * project's. Saved at once (`teamCall.sharing.set`) with a toast.
 */
export function CallSharingSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const t = useSettingsToast();
  const options = trpc.teamCall.sharing.get.queryOptions(undefined, { staleTime: 60_000 });
  const stored = useQuery(options);
  const update = useMutation(trpc.teamCall.sharing.set.mutationOptions());
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const on = optimistic ?? stored.data?.share ?? false;
  const change = (next: boolean) => {
    setOptimistic(next);
    update.mutateAsync({ share: next }).then(
      (saved) => {
        queryClient.setQueryData(options.queryKey, { share: saved.share });
        void queryClient.invalidateQueries({ queryKey: trpc.teamCall.pathKey() });
        setOptimistic(null);
        t.saved(saved.share ? "One-to-one calls shared" : "One-to-one calls private", saved.share ? "Everyone on the project can read your calls with one agent." : "Only you can read your calls with one agent.");
      },
      (err: unknown) => {
        setOptimistic(null);
        t.failed(err, "Preference not saved");
      },
    );
  };
  return (
    <SettingsSection title="Calls" data-testid="call-sharing-panel">
      <div className="flex items-start gap-3" data-testid="call-sharing-choice">
        <Switch id="call-sharing-switch" checked={on} disabled={stored.isPending} onCheckedChange={(next) => void change(next)} aria-describedby="call-sharing-hint" data-testid="call-sharing-switch" />
        <div className="flex flex-col gap-1">
          <Label htmlFor="call-sharing-switch">{TEAM_CALL_WORDS.shareSettingTitle}</Label>
          <p id="call-sharing-hint" className="text-small text-secondary">
            {TEAM_CALL_WORDS.shareSettingHint}
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}

/**
 * Your public profile (package 2.3): a page about the person at their own address, which needs no project. Edited on its
 * own account page (/public-profile); this section says where it is and whether it is public.
 */
export function PublicProfileSection() {
  const trpc = useTRPC();
  const profile = useQuery(trpc.founder.publicProfile.get.queryOptions(undefined, { staleTime: 60_000 }));
  const { formatDate } = useFormatters();
  const data = profile.data;
  return (
    <SettingsSection title="Your public profile" data-testid="public-profile-panel">
      <Hint>A page about you at its own address, with no project needed. Only you can see it until you publish it.</Hint>
      {data ? (
        <p className="t-body text-primary" data-testid="public-profile-panel-state">
          {personStateLine({ public: data.public, publishedOn: data.publishedAt ? formatDate(data.publishedAt) : null })}
        </p>
      ) : null}
      <div>
        <LinkButton icon={Globe} href={accountRoutes.publicProfile} data-testid="public-profile-edit">
          Edit your public profile
        </LinkButton>
      </div>
    </SettingsSection>
  );
}

export function PreferencesTab() {
  const { prefs, save } = useDatePreferences();
  const t = useSettingsToast();
  const now = useClientNow();
  const trpc = useTRPC();
  const viewer = useQuery(trpc.founder.profile.get.queryOptions(undefined, { staleTime: 5 * 60_000 }));

  const onChange = useCallback(
    (next: DateFormatPrefs) => {
      const change = preferenceChange(prefs, next);
      if (!change) return;
      save(change).then(
        (saved) => {
          const line = savedLine(saved, now ?? DATE_FORMAT_SAMPLE);
          t.saved(line.title, line.description);
        },
        (err: unknown) => t.failed(err, "Preference not saved"),
      );
    },
    [prefs, save, now, t],
  );

  return (
    <>
      <SettingsSection
        title="Preferences"
        actions={
          <Chip tone="neutral" icon={UserRound} data-testid="preferences-scope">
            Just for you
          </Chip>
        }
        data-testid="preferences-panel"
      >
        <Hint>
          How you read dates and times, in every business you open; nobody else’s view changes. Relative times such as “3 min ago” and dates written inside agent notes stay as they are.
        </Hint>
        <DateFormatPicker value={prefs} onChange={onChange} now={now} />
      </SettingsSection>
      <GuidanceSection />
      <AnthropomorphicAgentsSection />
      <BuilderViewSection />
      <EmailNotificationsSection />
      <CallSharingSection />
      <PublicProfileSection />
      <SettingsSection title="Your account ID" data-testid="account-id-panel">
        <AccountId accountId={viewer.data?.userId} />
      </SettingsSection>
    </>
  );
}
