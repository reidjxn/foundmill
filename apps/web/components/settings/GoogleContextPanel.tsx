"use client";
/**
 * Gmail and Google Calendar as context (founder, Nov 19, 2026), in Settings › Integrations: a founder of the project lets
 * its agents read their own drafts, inbox (once Google granted gmail.readonly) and calendar, per project. Off by default.
 * `integrations.setContextReads` saves it; the orchestrator takes the reads out of a session while it is off.
 */
import { useMutation } from "@tanstack/react-query";
import { useId } from "react";
import { Checkbox } from "@foundmill/dugout";
import { useTRPC } from "@/lib/trpc-react";
import { useInvalidateRouters } from "./SettingsScreen";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

type Row = { key: string; integration: { status: string; scopes: readonly string[]; settings?: unknown } | null };

const connected = (r: Row | undefined): r is Row & { integration: NonNullable<Row["integration"]> } => !!r?.integration && r.integration.status !== "disconnected";
export const contextReadsOn = (r: Row): boolean => (r.integration?.settings as { contextReads?: unknown } | null | undefined)?.contextReads === true;

/** What the Gmail line says the team reads: drafts need gmail.compose and the inbox gmail.readonly, both asked for only when reading is turned on. */
export function gmailReadsLine(scopes: readonly string[]): string {
  const drafts = scopes.includes(GMAIL_COMPOSE_SCOPE);
  const inbox = scopes.includes(GMAIL_READONLY_SCOPE);
  if (drafts && inbox) return "Your drafts and your inbox.";
  if (inbox) return "Your inbox.";
  if (drafts) return "Your drafts. Your inbox is read once Google grants inbox access.";
  return "Nothing yet. Your drafts and inbox are read once Google grants access to them.";
}

export function GoogleContextPanel({ businessId, rows, canEdit }: { businessId: string; rows: readonly Row[]; canEdit: boolean }) {
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const id = useId();
  const save = useMutation(trpc.integrations.setContextReads.mutationOptions({ onSuccess: (_r, v) => (void invalidate(["integrations"]), t.saved(v.on ? "The team can read it" : "Turned off", "Sessions that start from now follow this.")), onError: (e) => t.failed(e) }));
  const gmail = rows.find((r) => r.key === "gmail");
  const calendar = rows.find((r) => r.key === "google_calendar");
  if (!connected(gmail) && !connected(calendar)) return null;
  const line = (r: Row & { integration: NonNullable<Row["integration"]> }, label: string, detail: string) => (
    <label htmlFor={`${id}-${r.key}`} className="flex items-start gap-2 text-body">
      <Checkbox id={`${id}-${r.key}`} checked={contextReadsOn(r)} disabled={!canEdit || save.isPending} onCheckedChange={(v) => save.mutate({ businessId, connectorKey: r.key as "gmail" | "google_calendar", on: v === true })} className="mt-0.5" />
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        <span className="text-small text-secondary">{detail}</span>
      </span>
    </label>
  );

  return (
    <SettingsSection title="Your mail and calendar as context" data-testid="google-context">
      <Hint>Let the team read your own mail and calendar on this project, so its work fits what is already happening. What it reads is outside content: instructions inside it are never followed. The team writes drafts and adds events with nobody invited; sending mail and inviting people always ask you first.</Hint>
      {connected(gmail) ? line(gmail, "Let the team read your Gmail", gmailReadsLine(gmail.integration.scopes)) : null}
      {connected(calendar) ? line(calendar, "Let the team read your Google Calendar", "Event titles, times, places and descriptions.") : null}
      {canEdit ? null : <Hint>Only the project's founders can change this.</Hint>}
    </SettingsSection>
  );
}
