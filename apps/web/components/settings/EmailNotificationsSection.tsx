"use client";
/**
 * Settings › Preferences › Email (packages 1.5 and 5.1; retention plan, 2026-11-11; one sender and one preference since
 * 2026-11-12): which emails Foundmill sends the person about their own projects, one switch per kind, all on by default
 * (`account_preferences.notifications.email`, saved at once through `founder.preferences.update` with `email`; the
 * link at the foot of every email turns its own switch off). Below them: the morning brief's hour (in the browser's
 * time zone, saved with it), opt-in browser notifications for wins, the pause, and the latest emails sent to them in
 * this business (`founder.email.*`).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { APP_NAME } from "@foundmill/config";
import { BellRing, Mail } from "lucide-react";
import { Button, Chip, Field, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Skeleton, Switch, formatDateTime, useDateFormat } from "@foundmill/dugout";
import { EMAIL_NOTIFICATION_KINDS, type EmailNotificationKind } from "@foundmill/shared/constants";
import { EMAIL_NOTIFICATION_HINTS, EMAIL_NOTIFICATION_LABELS, EMAIL_NOTIFICATIONS_HINT, emailNotificationSavedLine } from "@foundmill/shared/notify-email";
import { HOUR_OPTIONS } from "@/lib/autopilot";
import { browserTimeZone } from "@/lib/today";
import { useTRPC } from "@/lib/trpc-react";
import { useOptionalBusiness } from "@/components/shell/business-context";
import { browserNotificationsSupported, requestBrowserNotifications } from "@/lib/browser-notifications";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

/** The status words of a recent email row (the gateway's reason codes, `NOTIFY_EMAIL_REFUSALS`). */
export function recentStatusWord(status: string, skipReason: string | null): string {
  if (status === "sent") return "Sent";
  if (status === "failed") return "Not delivered";
  if (status === "skipped") {
    switch (skipReason) {
      case "turned_off":
        return "Not sent: turned off";
      case "paused":
        return "Not sent: emails paused";
      case "per_project":
      case "per_person":
        return "Not sent: daily limit";
      case "nothing_new":
        return "Not sent: nothing new";
      default:
        return "Not sent";
    }
  }
  return "Sending";
}

/** `email-decision-waiting-switch`, `email-daily-brief-switch`... */
const switchId = (kind: EmailNotificationKind) => `email-${kind.replace(/_/g, "-")}-switch`;

export function EmailNotificationsSection() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const t = useSettingsToast();
  const businessId = useOptionalBusiness()?.businessId ?? null;
  const datePrefs = useDateFormat();
  const switchesOptions = trpc.founder.preferences.notifications.queryOptions(undefined, { staleTime: 60_000 });
  const switches = useQuery(switchesOptions);
  const prefs = useQuery(trpc.founder.email.get.queryOptions());
  const recent = useQuery({ ...trpc.founder.email.recent.queryOptions({ businessId: businessId ?? "", limit: 8 }), enabled: businessId !== null });
  const saveSwitch = useMutation(trpc.founder.preferences.update.mutationOptions());
  const update = useMutation(
    trpc.founder.email.update.mutationOptions({
      onSuccess: (saved) => {
        qc.setQueryData(trpc.founder.email.get.queryKey(), saved);
        t.saved("Email preferences saved");
      },
      onError: (err) => t.failed(err, "Email preferences not saved"),
    }),
  );
  const [optimistic, setOptimistic] = useState<Partial<Record<EmailNotificationKind, boolean>>>({});
  const isOn = (kind: EmailNotificationKind) => optimistic[kind] ?? switches.data?.email?.[kind] ?? true;
  const change = (kind: EmailNotificationKind, next: boolean) => {
    setOptimistic((o) => ({ ...o, [kind]: next }));
    const clear = () =>
      setOptimistic((o) => {
        const { [kind]: _done, ...rest } = o;
        return rest;
      });
    saveSwitch.mutateAsync({ email: { [kind]: next } }).then(
      (saved) => {
        qc.setQueryData(switchesOptions.queryKey, { notifications: saved.notifications, hideAmountsOnLockScreen: saved.hideAmountsOnLockScreen, email: saved.email });
        void qc.invalidateQueries({ queryKey: trpc.founder.email.get.queryKey() });
        clear();
        const line = emailNotificationSavedLine(kind, saved.email[kind]);
        t.saved(line.title, line.description);
      },
      (err: unknown) => {
        clear();
        t.failed(err, "Preference not saved");
      },
    );
  };
  const p = prefs.data;

  return (
    <SettingsSection title="Email" actions={p?.emailsPausedAt ? <Chip tone="warn" icon={Mail}>Paused</Chip> : null} data-testid="email-notifications-panel">
      <Hint>{EMAIL_NOTIFICATIONS_HINT}</Hint>
      {p?.emailsPausedAt ? (
        <div className="flex items-center gap-3" data-testid="emails-paused">
          <p className="text-body text-primary">Every email is paused.</p>
          <Button size="sm" variant="secondary" loading={update.isPending} onClick={() => update.mutate({ emailsPaused: false })}>
            Turn emails back on
          </Button>
        </div>
      ) : null}
      <div className="flex flex-col gap-3" data-testid="email-kinds">
        {EMAIL_NOTIFICATION_KINDS.map((kind) => {
          const id = switchId(kind);
          return (
            <div key={kind} className="flex items-start gap-3">
              <Switch id={id} checked={isOn(kind)} disabled={switches.isPending} onCheckedChange={(next) => change(kind, next)} aria-describedby={`${id}-hint`} data-testid={id} />
              <div className="flex flex-col gap-1">
                <Label htmlFor={id}>{EMAIL_NOTIFICATION_LABELS[kind]}</Label>
                <p id={`${id}-hint`} className="text-small text-secondary">
                  {EMAIL_NOTIFICATION_HINTS[kind]}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {!p ? (
        <Skeleton label="Loading email preferences" className="h-24" />
      ) : (
        <>
          <Field htmlFor="email-brief-hour" label="Send the morning brief at" hint={`In ${p.timeZone ?? browserTimeZone() ?? "your time zone"}. Monday's is the weekly review.`}>
            <Select value={String(p.briefHour)} onValueChange={(v) => update.mutate({ briefHour: Number(v), timeZone: browserTimeZone() ?? null })}>
              <SelectTrigger id="email-brief-hour" controlSize="lg" data-testid="email-brief-hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-start gap-3">
            <Switch
              id="browser-notifications"
              checked={p.browserNotifications}
              disabled={!browserNotificationsSupported()}
              onCheckedChange={async (on) => {
                if (on && !(await requestBrowserNotifications())) {
                  t.info("Notifications are blocked", "Allow notifications for this site in your browser's settings, then try again.");
                  return;
                }
                update.mutate({ browserNotifications: on });
              }}
              aria-describedby="browser-notifications-hint"
              data-testid="browser-notifications-switch"
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="browser-notifications">Browser notifications</Label>
              <p id="browser-notifications-hint" className="text-small text-secondary">
                {`A desktop notification when a customer is won or a goal is reached while ${APP_NAME} is open in another tab.`}
              </p>
            </div>
          </div>
          {!p.emailsPausedAt ? (
            <div>
              <Button size="sm" variant="ghost" icon={BellRing} onClick={() => update.mutate({ emailsPaused: true })} data-testid="pause-emails">
                Pause every email
              </Button>
            </div>
          ) : null}
        </>
      )}
      {businessId ? (
        <div className="flex flex-col gap-2" data-testid="email-recent">
          <p className="text-small-strong text-primary">Latest emails</p>
          {recent.data && recent.data.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {recent.data.map((n) => (
                <li key={n.id} className="flex items-baseline justify-between gap-4 text-small">
                  <span className="truncate text-primary">{n.subject || EMAIL_NOTIFICATION_LABELS[n.kind]}</span>
                  <span className="shrink-0 font-mono text-secondary">
                    {recentStatusWord(n.status, n.skipReason)} · {formatDateTime(n.sentAt ?? n.createdAt, datePrefs)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Hint>No emails yet. Your first morning brief arrives after your team has done some work.</Hint>
          )}
        </div>
      ) : null}
    </SettingsSection>
  );
}
