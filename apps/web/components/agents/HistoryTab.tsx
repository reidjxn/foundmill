"use client";
/**
 * History tab (BUILD §11.10 "History and logs"): one Timeline of everything that changed this agent — versions
 * (drafted, promoted, retired), training runs (queued → results → promoted / discarded / rolled back) and the
 * sessions it ran — plus a metrics strip over the last 30 days, computed by `agent.profile.get` from the agent's own
 * sessions, usage and approvals (`recent`), so it agrees with the sessions listed and with the wage.
 */
import { Dumbbell, FileClock, Play, Undo2 } from "lucide-react";
import { useMemo } from "react";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { Panel, StatusStrip, Timeline, formatMoney, type MetricTileProps, type TimelineEvent } from "@foundmill/dugout";
import type { TabProps } from "./AgentProfileScreen";
import { MODEL_LABELS } from "@foundmill/dugout";
import { RUN_PHASE_LABEL, isRetestRun, isRetestVersion, outcomeWord, sessionRows, toIso } from "./logic";
import { formatNumber } from "@/lib/format";

/** "opus" → "Opus" (the model's display name). */
const modelWord = (key: string): string => (MODEL_LABELS as Record<string, string>)[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

export function historyEvents(profile: TabProps["profile"], currency: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const v of profile.versions) {
    events.push({
      id: `version-${v.id}`,
      at: toIso(v.createdAt) ?? new Date(0),
      title: `Version ${v.version} ${v.state === "live" ? "is live" : v.state === "draft" ? "drafted" : "retired"}`,
      description: `${v.createdByKind === "user" ? "You" : v.createdByKind === "agent" ? "Coach" : isRetestVersion(v) ? "Retest after a model change" : "Set up with the business"} · ${modelWord(v.modelKey)} · ${(v.tools as unknown[]).length} tool ${(v.tools as unknown[]).length === 1 ? "grant" : "grants"}`,
      icon: FileClock,
      tone: v.state === "live" ? "good" : v.state === "draft" ? "info" : "neutral",
      statusWord: outcomeWord(v.state),
    });
  }
  for (const r of profile.trainingRuns) {
    // Skills the run scored: one it found no tests for (`tests` 0, a library or file skill) was not graded.
    const n = Object.values(r.results ?? {}).filter((x) => x.tests !== 0).length;
    const kind = isRetestRun(r, profile.versions) ? "Retest" : "Training";
    events.push({
      id: `run-${r.id}`,
      at: toIso(r.endedAt ?? r.startedAt ?? r.createdAt) ?? new Date(0),
      title: r.decision === "promoted" ? `${kind} promoted` : r.decision === "discarded" ? `${kind} discarded` : `${kind} ${RUN_PHASE_LABEL[r.status]?.toLowerCase() ?? r.status}`,
      description: `${n ? `${n} skills graded · ` : ""}${formatMoney({ amountMinor: Number(r.costMinor ?? 0), currency: r.currency ?? currency })}`,
      icon: r.decision === "discarded" ? Undo2 : Dumbbell,
      tone: r.decision === "promoted" ? "good" : r.decision === "discarded" ? "warn" : r.status === "failed" ? "bad" : "info",
      statusWord: r.decision ? outcomeWord(r.decision) : (RUN_PHASE_LABEL[r.status] ?? outcomeWord(r.status)),
    });
  }
  for (const s of sessionRows(profile.sessions)) {
    events.push({
      id: `session-${s.id}`,
      at: s.startedAt,
      title: s.live ? "Session running" : `Session ${outcomeWord(s.outcome).toLowerCase()}`,
      description: `${modelWord(s.model)} · ${formatNumber(s.tokens)} tokens · ${formatMoney({ amountMinor: s.costMinor, currency: s.currency })}`,
      icon: Play,
      tone: s.live ? "info" : s.outcome === "failure" || s.outcome === "failed" ? "bad" : "neutral",
      statusWord: outcomeWord(s.outcome),
    });
  }
  return events.sort((a, b) => Date.parse(String(b.at)) - Date.parse(String(a.at)));
}

export function HistoryTab({ profile, currency }: TabProps) {
  const events = useMemo(() => historyEvents(profile, currency), [profile, currency]);
  const { metrics, recent } = profile;
  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="agent-history">
      <div className="col-span-12">
        <StatusStrip
          tiles={[
            { label: "Tasks done · 30 d", value: recent.tasksDone, format: "integer", spark: metrics.map((m) => m.tasksDone) },
            { label: "Success rate", value: recent.successRate, format: "percent", caption: recent.sessions ? `${recent.tasksDone} of ${recent.sessions} sessions` : undefined },
            { label: "Review findings", value: recent.reviewFindings, format: "integer", delta: recent.reviewFindings ? { value: recent.reviewFindings, goodWhen: "down", label: "open" } : undefined },
            { label: "Approvals rejected", value: recent.approvalsRejected, format: "integer" },
            { label: "Cost · 30 d", value: { amountMinor: recent.costMinor, currency: recent.currency }, estimate: "estimate", provenance: { source: "Model and tool usage, last 30 days (the usage ledger, as the wage)" } },
          ] satisfies MetricTileProps[]}
        />
      </div>
      <Panel title="History" span={12} empty={events.length === 0 ? { children: "Versions, training runs and sessions appear here as they happen." } : undefined} data-testid="history-timeline">
        <Timeline events={events} absolute />
      </Panel>
    </div>
  );
}
