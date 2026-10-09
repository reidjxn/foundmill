"use client";
/**
 * Development › Code: the code agents wrote on code tasks. The orchestrator saves a task's workspace when each session
 * ends and restores it when the next one starts (0013 workspaces), so the work survives while GitHub is simulated.
 * Left: tasks with saved code. Right: one saved session's files and the selected file in a CodeViewer.
 */
import { useEffect, useMemo, useState } from "react";
import { FileCode, FolderGit2, GitBranch, Network, Search, Trash2 } from "lucide-react";
import { Avatar, Button, Chip, CodeViewer, DataTable, EmptyState, ErrorState, Input, Panel, SimpleSelect, cn, formatBytes, formatDate, formatDateTime, formatNumber, formatRelative, type DataTableColumn, type SelectOption } from "@foundmill/dugout";
import { departmentForModule, routes, useBusinessEvents, useDepartments, useWidgetData, useWidgetQuery } from "@foundmill/widgets";
import type { ModuleScreenProps } from "../registry";
import { ForgetCodeDialog } from "./dialogs";
import { useDevScreenOptions } from "./options";
import { Screen, TaskStatusPill, taskHref, toDate, toTileAgent, useAction, useAgentIndex, useAgents } from "./shared";
import type { AgentRow, CodeFileResponse, CodeFilesResponse, CodeManifestEntry, CodeSnapshotSummary, CodeTaskRow } from "./types";

/** Body height of both panels, so the task list and the file view line up. */
export const CODE_PANEL_HEIGHT = 560;
/** The branch and saved-session line above the files (h-panel-header). */
const CODE_TOOLBAR_HEIGHT = 32;
/** Files opened first when a saved session is shown, in order of preference. */
const FIRST_FILES = ["README.md", "readme.md", "package.json"];
/** Above this many files the list gets a filter box. */
const FILTER_FROM = 12;
const SAVED_FOOTER = "Saved when each session ends. The next session on a task starts from its latest save.";

export interface CodeTaskTableRow extends CodeTaskRow {
  id: string;
  agent: AgentRow | undefined;
  agentName: string;
  fileCount: number;
  savedAt: Date | null;
}

export function toCodeRows(tasks: readonly CodeTaskRow[], agents: Map<string, AgentRow>): CodeTaskTableRow[] {
  return tasks.map((t) => {
    const agentId = t.latest.agentId ?? t.assigneeAgentId;
    const agent = agentId ? agents.get(agentId) : undefined;
    return { ...t, id: t.taskId, agent, agentName: agent?.name ?? (agentId ? "Agent" : "Unassigned"), fileCount: t.latest.fileCount, savedAt: toDate(t.latest.createdAt) };
  });
}

/** The file to open first: a README or package.json when there is one, else the first file. */
export function firstFile(files: readonly CodeManifestEntry[]): string | null {
  for (const name of FIRST_FILES) if (files.some((f) => f.path === name)) return name;
  return files[0]?.path ?? null;
}

const fileCount = (n: number) => `${formatNumber(n)} ${n === 1 ? "file" : "files"}`;

/** One line per saved session for the selector: when and how many files (the footer says what changed). */
export function sessionLabel(s: CodeSnapshotSummary, latest: boolean): string {
  return `${latest ? "Latest · " : ""}${formatDate(s.createdAt, "d MMM, HH:mm")} · ${fileCount(s.fileCount)}`;
}

function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

function FileList({ files, selected, onSelect }: { files: readonly CodeManifestEntry[]; selected: string | null; onSelect: (path: string) => void }) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files;
  }, [files, filter]);
  return (
    <nav aria-label="Files" className="flex w-64 shrink-0 flex-col border-r border-subtle bg-panel">
      {files.length > FILTER_FROM ? (
        <div className="shrink-0 border-b border-subtle p-2">
          <Input controlSize="sm" icon={Search} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" aria-label="Filter files" />
        </div>
      ) : null}
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.map((f) => {
          const { dir, name } = splitPath(f.path);
          const active = f.path === selected;
          return (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => onSelect(f.path)}
                aria-current={active ? "true" : undefined}
                title={f.path}
                className={cn("flex h-row-compact w-full items-center gap-2 px-2 text-left hover:bg-white/4", active && "border-l-3 border-kit-primary bg-white/4 pl-1.5")}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-mono">
                  <span className="text-secondary">{dir}</span>
                  <span className={active ? "text-primary" : "text-primary/90"}>{name}</span>
                </span>
                <span className="shrink-0 text-small tabular-nums text-secondary">{formatBytes(f.size)}</span>
              </button>
            </li>
          );
        })}
        {shown.length === 0 ? <li className="px-2.5 py-2 text-small text-secondary">No file matches “{filter}”.</li> : null}
      </ul>
    </nav>
  );
}

export function CodeScreen({ businessId }: ModuleScreenProps) {
  const { navigate } = useWidgetData();
  const options = useDevScreenOptions();
  const optionNow = options.now;
  const now = useMemo(() => optionNow ?? new Date(), [optionNow]);
  const departments = useDepartments();
  const deptSlug = departmentForModule(departments.data, "development")?.slug;
  const list = useWidgetQuery<CodeTaskRow[]>("dev.code.list", {});
  const agents = useAgents();
  const agentIndex = useAgentIndex(agents.data?.agents);
  useBusinessEvents(() => list.refetch(), ["task.completed", "task.blocked"]);

  const rows = useMemo(() => toCodeRows(list.data ?? [], agentIndex), [list.data, agentIndex]);
  const initialTask = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("task") : null;
  const [taskId, setTaskId] = useState<string | null>(initialTask);
  const selectedTask = rows.find((r) => r.taskId === taskId) ?? rows[0] ?? null;
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  useEffect(() => setSnapshotId(null), [selectedTask?.taskId]);

  const files = useWidgetQuery<CodeFilesResponse>("dev.code.files", selectedTask ? { taskId: selectedTask.taskId, ...(snapshotId ? { snapshotId } : {}) } : {}, { enabled: !!selectedTask });
  const snapshot = files.data?.taskId === selectedTask?.taskId ? (files.data?.snapshot ?? null) : null;
  const [path, setPath] = useState<string | null>(null);
  const manifest = snapshot?.files;
  // Keep the open file across sessions when it still exists; otherwise open the README (or the first file).
  useEffect(() => {
    if (!manifest) return;
    setPath((p) => (p && manifest.some((f) => f.path === p) ? p : firstFile(manifest)));
  }, [manifest]);
  const entry = manifest?.find((f) => f.path === path) ?? null;
  const file = useWidgetQuery<CodeFileResponse>("dev.code.file", snapshot && entry ? { snapshotId: snapshot.id, path: entry.path } : {}, { enabled: !!snapshot && !!entry });

  const historyData = files.data?.history;
  const history = useMemo(() => historyData ?? [], [historyData]);
  const sessionOptions = useMemo<SelectOption[]>(() => history.map((s, i) => ({ value: s.id, label: sessionLabel(s, i === 0), textValue: formatDateTime(s.createdAt) })), [history]);

  const columns = useMemo<DataTableColumn<CodeTaskTableRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: "Task",
        size: 220,
        meta: { locked: true },
        cell: ({ row }) => {
          const a = row.original.agent;
          const tile = toTileAgent(a, row.original.latest.agentId ?? row.original.assigneeAgentId);
          return (
            <span className="flex min-w-0 items-center gap-1.5" title={`${row.original.title} · ${row.original.agentName}`}>
              <Avatar size={20} name={tile.name} agent={{ seed: tile.seed, dept: tile.dept }} status={a?.status} />
              <span className="truncate text-body-strong">{row.original.title}</span>
            </span>
          );
        },
      },
      { id: "fileCount", accessorKey: "fileCount", header: "Files", size: 64, meta: { numeric: true }, cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.fileCount)}</span> },
      { id: "savedAt", accessorFn: (r) => r.savedAt?.getTime() ?? 0, header: "Saved", size: 96, meta: { filter: "date", label: "Saved" }, cell: ({ row }) => (row.original.savedAt ? <span className="truncate" title={formatDateTime(row.original.savedAt)}>{formatRelative(row.original.savedAt, now, { style: "narrow" })}</span> : "—") },
    ],
    [now],
  );

  const goToPlan = () => navigate(routes.department(businessId, deptSlug ?? "development", "plan"));
  const action = useAction();
  const [forgetting, setForgetting] = useState(false);
  const forget = () => {
    if (!selectedTask) return;
    void action.run("dev.code.forget", { taskId: selectedTask.taskId }, {
      key: "forget",
      then: () => {
        setForgetting(false);
        setTaskId(null);
        list.refetch();
      },
    });
  };
  const savedAt = snapshot ? toDate(snapshot.createdAt) : null;
  const savedBy = snapshot?.agentId ? agentIndex.get(snapshot.agentId)?.name : undefined;

  if (list.data && rows.length === 0) {
    return (
      <Screen name="development/code">
        <Panel
          span={12}
          title="Saved code"
          empty={{ icon: FolderGit2, title: "No saved code yet", children: "When an agent's session on a code task ends, the files it wrote are saved here, and the next session on that task carries on from them.", action: { label: "Go to Plan", onClick: goToPlan } }}
          footer={<span>{SAVED_FOOTER}</span>}
        />
      </Screen>
    );
  }

  return (
    <Screen name="development/code">
      <Panel
        span={4}
        title="Saved code"
        flush
        loading={list.isLoading}
        error={list.error ? list.error.message : undefined}
        onRetry={list.refetch}
        footer={<span>{SAVED_FOOTER}</span>}
      >
        <DataTable<CodeTaskTableRow>
          data={rows}
          columns={columns}
          selectedIds={selectedTask ? [selectedTask.taskId] : []}
          onRowClick={(r) => setTaskId(r.taskId)}
          onRowOpen={(r) => setTaskId(r.taskId)}
          height={CODE_PANEL_HEIGHT}
          hideToolbar
          footer={null}
          aria-label="Tasks with saved code"
        />
      </Panel>

      <Panel
        span={8}
        title={selectedTask ? selectedTask.title : "Files"}
        flush
        loading={!!selectedTask && files.isLoading && !files.data}
        error={files.error ? files.error.message : undefined}
        onRetry={files.refetch}
        actions={
          selectedTask ? (
            <div className="flex items-center gap-2">
              <TaskStatusPill status={selectedTask.status} />
              <Button size="sm" variant="ghost" icon={Network} onClick={() => navigate(taskHref(businessId, deptSlug, selectedTask.taskId))}>
                Show in Plan
              </Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setForgetting(true)} title="Owners and admins can delete this task's saved code">
                Forget
              </Button>
            </div>
          ) : null
        }
        footer={
          snapshot && savedAt ? (
            <span data-testid="code-summary">
              {fileCount(snapshot.fileCount)} · {formatBytes(snapshot.totalBytes)} · saved {formatRelative(savedAt, now)}
              {savedBy ? ` by ${savedBy}` : ""}
              {snapshot.added + snapshot.changed + snapshot.removed > 0 ? ` · ${snapshot.added} added, ${snapshot.changed} changed, ${snapshot.removed} removed by that session` : ""}
            </span>
          ) : undefined
        }
      >
        {selectedTask ? (
          <div className="flex h-panel-header items-center gap-2 border-b border-subtle px-2.5">
            <Chip icon={GitBranch} mono title="The branch this work goes to once GitHub is connected">
              {files.data?.branch ?? `agent/${selectedTask.taskId}`}
            </Chip>
            <span className="flex-1" />
            {sessionOptions.length > 1 ? (
              <SimpleSelect controlSize="sm" options={sessionOptions} value={snapshot?.id ?? sessionOptions[0]?.value} onValueChange={(v) => setSnapshotId(v === history[0]?.id ? null : v)} aria-label="Saved session" className="w-80" />
            ) : history[0] ? (
              <span className="text-small text-secondary">{sessionLabel(history[0], false)}</span>
            ) : null}
          </div>
        ) : null}
        <div className="flex min-h-0" style={{ height: CODE_PANEL_HEIGHT - CODE_TOOLBAR_HEIGHT }}>
          {snapshot && snapshot.files.length > 0 ? (
            <>
              <FileList files={snapshot.files} selected={path} onSelect={setPath} />
              <div className="flex min-h-0 min-w-0 flex-1 p-2">
                {entry && file.error ? (
                  <ErrorState className="m-auto" onRetry={file.refetch}>
                    {entry.path} could not be read: {file.error.message}
                  </ErrorState>
                ) : entry ? (
                  <CodeViewer
                    className="flex-1"
                    path={entry.path}
                    size={entry.size}
                    loading={file.isLoading || file.data?.path !== entry.path}
                    text={file.data?.text ?? null}
                    binary={file.data?.binary}
                    truncated={file.data?.truncated}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <EmptyState icon={FileCode} className="m-auto">
              {snapshot ? "This session left the workspace empty." : "Pick a task on the left to read its code."}
            </EmptyState>
          )}
        </div>
      </Panel>

      <ForgetCodeDialog
        open={forgetting && !!selectedTask}
        onOpenChange={(o) => {
          setForgetting(o);
          if (!o) action.clearError();
        }}
        taskTitle={selectedTask?.title ?? ""}
        pending={action.pending === "forget"}
        error={forgetting ? action.error : null}
        onConfirm={forget}
      />
    </Screen>
  );
}
