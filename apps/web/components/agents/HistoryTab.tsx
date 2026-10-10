"use client";
/**
 * History tab (BUILD §11.10 "History and logs"): one Timeline of everything that changed this agent — versions
 * (drafted, promoted, retired), training runs (queued → results → promoted / discarded / rolled back) and the
 * sessions it ran — plus a metrics strip over the last 30 days from `agent_metrics`.
 */
import { Dumbbell, FileClock, Play, Undo2 } from "lucide-react";
import { useMemo } from "react";
import { Panel, StatusStrip, Timeline, formatMoney, type MetricTileProps, type TimelineEvent } from "@foundmill/dugout";
import type { TabProps } from "./AgentProfileScreen";
import { MODEL_LABELS } from "@foundmill/dugout";
import { RUN_PHASE_LABEL, outcomeWord, sessionRows, toIso } from "./logic";

/** "opus" → "Opus" (the model's display name). */
const modelWord = (key: string): string => (MODEL_LABELS as Record<string, string>)[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

export function historyEvents(profile: TabProps["profile"], currency: string): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const v of profile.versions) {
    events.push({
      id: `version-${v.id}`,
      at: toIso(v.createdAt) ?? new Date(0),
      title: `Version ${v.version} ${v.state === "live" ? "is live" : v.state === "draft" ? "drafted" : "retired"}`,
      description: `${v.createdByKind === "user" ? "You" : v.createdByKind === "agent" ? "Coach" : "Set up with the business"} · ${modelWord(v.modelKey)} · ${(v.tools as unknown[]).length} tool ${(v.tools as unknown[]).length === 1 ? "grant" : "grants"}`,
      icon: FileClock,
      tone: v.state === "live" ? "good" : v.state === "draft" ? "info" : "neutral",
      statusWord: outcomeWord(v.state),
    });
  }
  for (const r of profile.trainingRuns) {
    const n = Object.keys(r.results ?? {}).length;
    events.push({
      id: `run-${r.id}`,
      at: toIso(r.endedAt ?? r.startedAt ?? r.createdAt) ?? new Date(0),
      title: r.decision === "promoted" ? (r.fromVersionId === r.toVersionId ? "Retest promoted" : "Training promoted") : r.decision === "discarded" ? "Training discarded" : `Training ${RUN_PHASE_LABEL[r.status]?.toLowerCase() ?? r.status}`,
      description: `${n ? `${n} skills graded · ` : ""}${formatMoney({ amountMinor: Number(r.costMinor ?? 0), currency: r.currency ?? currency })}`,
      icon: r.decision === "discarded" ? Undo2 : Dumbbell,
      tone: r.decision === "promoted" ? "good" : r.decision === "discarded" ? "warn" : r.status === "failed" ? "bad" : "info",
      statusWord: outcomeWord(r.decision ?? r.status),
    });
  }
  for (const s of sessionRows(profile.sessions)) {
    events.push({
      id: `session-${s.id}`,
      at: s.startedAt,
      title: s.live ? "Session running" : `Session ${outcomeWord(s.outcome).toLowerCase()}`,
      description: `${modelWord(s.model)} · ${s.tokens.toLocaleString("en-GB")} tokens · ${formatMoney({ amountMinor: s.costMinor, currency: s.currency })}`,
      icon: Play,
      tone: s.live ? "info" : s.outcome === "failure" || s.outcome === "failed" ? "bad" : "neutral",
      statusWord: outcomeWord(s.outcome),
    });
  }
  return events.sort((a, b) => Date.parse(String(b.at)) - Date.parse(String(a.at)));
}

export function HistoryTab({ profile, currency }: TabProps) {
  const events = useMemo(() => historyEvents(profile, currency), [profile, currency]);
  const metrics = profile.metrics;
  const tasks = metrics.reduce((s, m) => s + m.tasksDone, 0);
  const findings = metrics.reduce((s, m) => s + m.reviewFindings, 0);
  const rejected = metrics.reduce((s, m) => s + m.approvalsRejected, 0);
  const rates = metrics.map((m) => Number(m.successRate)).filter((n) => Number.isFinite(n));
  const success = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
  const cost = metrics.reduce((s, m) => s + Number(m.costMinor ?? 0), 0);
  return (
    <div className="grid grid-cols-12 gap-gutter p-gutter" data-testid="agent-history">
      <div className="col-span-12">
        <StatusStrip
          tiles={[
            { label: "Tasks done · 30 d", value: tasks, format: "integer", spark: metrics.map((m) => m.tasksDone) },
            { label: "Success rate", value: success, format: "percent" },
            { label: "Review findings", value: findings, format: "integer", delta: findings ? { value: findings, goodWhen: "down", label: "open" } : undefined },
            { label: "Approvals rejected", value: rejected, format: "integer" },
            { label: "Cost · 30 d", value: { amountMinor: cost, currency }, estimate: "estimate", provenance: { source: "Model and tool usage, last 30 days" } },
          ] satisfies MetricTileProps[]}
        />
      </div>
      <Panel title="History" span={12} empty={events.length === 0 ? { children: "Versions, training runs and sessions appear here as they happen." } : undefined} data-testid="history-timeline">
        <Timeline events={events} absolute />
      </Panel>
    </div>
  );
}
