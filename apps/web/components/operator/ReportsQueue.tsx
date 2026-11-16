"use client";
/**
 * The review queue (/operator/reports; api `operator.reports.*`): open reports oldest first, each with when it is due
 * (REPORT_RESPONSE_TARGET_HOURS after it arrived), what it is about, the reason, who sent it, the reported message as it
 * reads now and the reporter's note. Notes and messages are untrusted words: shown as plain text, never sent to a model.
 * A non-operator gets the same not-found as an address that does not exist.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { useMemo } from "react";
import {
  Button,
  Chip,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Panel,
  StatusPill,
  useFormatters,
  useToast,
  type DataTableColumn,
} from "@foundmill/dugout";
import {
  REPORT_REASON_LABELS,
  REPORT_RESOLUTION_LABELS,
  REPORT_RESOLUTIONS,
  REPORT_RESPONSE_TARGET_HOURS,
} from "@foundmill/shared/reports";
import { errorMessage, trpcErrorCode, trpcPathPrefix, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";
import { StudioFrame } from "@/components/new/StudioFrame";

type Row = RouterOutputs["operator"]["reports"]["list"]["reports"][number];

const KIND: Record<Row["targetKind"], string> = {
  person: "Person",
  profile: "Profile",
  message: "Message",
};

export function ReportsQueue({ viewer }: { viewer: { email: string | null } }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { formatDateTime } = useFormatters();
  const q = useQuery(
    trpc.operator.reports.list.queryOptions(undefined, { retry: false, refetchInterval: 60_000 }),
  );
  const resolve = useMutation(
    trpc.operator.reports.resolve.mutationOptions({
      onSuccess: (r) => {
        void qc.invalidateQueries({ queryKey: trpcPathPrefix("operator.reports") as unknown[] });
        toast({
          title: r.resolved ? "Marked reviewed" : "Already reviewed",
          tone: r.resolved ? "good" : "info",
        });
      },
      onError: (err) => toast({ title: "Not saved", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const now = Date.now();
  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: "When",
        size: 150,
        cell: ({ row }) => (
          <span className="font-mono text-mono text-secondary">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "dueAt",
        accessorKey: "dueAt",
        header: "Due by",
        size: 170,
        cell: ({ row }) => {
          const late = new Date(row.original.dueAt).getTime() < now;
          return (
            <StatusPill tone={late ? "bad" : "neutral"}>
              {late
                ? `Overdue, ${formatDateTime(row.original.dueAt)}`
                : formatDateTime(row.original.dueAt)}
            </StatusPill>
          );
        },
      },
      {
        id: "kind",
        accessorFn: (r) => KIND[r.targetKind],
        header: "Kind",
        size: 96,
        cell: ({ row }) => <Chip tone="neutral">{KIND[row.original.targetKind]}</Chip>,
      },
      {
        id: "reason",
        accessorFn: (r) => REPORT_REASON_LABELS[r.reason],
        header: "Reason",
        size: 200,
      },
      {
        id: "about",
        accessorFn: (r) => r.targetName ?? "",
        header: "About",
        size: 180,
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body-strong">
              {row.original.targetName ?? "Account deleted"}
            </span>
            <span className="truncate text-small text-secondary">
              {row.original.targetHandle
                ? `/u/${row.original.targetHandle}`
                : (row.original.targetUserId ?? "")}
              {row.original.openAboutPerson > 1
                ? ` · ${row.original.openAboutPerson} open reports`
                : ""}
            </span>
          </span>
        ),
      },
      {
        id: "who",
        accessorFn: (r) => r.reporterName ?? "",
        header: "Who reported",
        size: 140,
        cell: ({ row }) => (
          <span className="truncate">{row.original.reporterName ?? "Unnamed account"}</span>
        ),
      },
      {
        id: "words",
        accessorFn: (r) => `${r.messageBody ?? ""} ${r.note ?? ""}`,
        header: "Message and note",
        size: 320,
        meta: { grow: 1 },
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col gap-1 whitespace-pre-wrap break-words">
            {row.original.targetKind === "message" ? (
              <span className="text-primary">{row.original.messageBody ?? "Message deleted"}</span>
            ) : null}
            {row.original.note ? (
              <span className="text-small text-secondary">Note: {row.original.note}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: "review",
        header: "Review",
        size: 140,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                icon={Check}
                loading={resolve.isPending && resolve.variables?.reportId === row.original.id}
                data-testid="report-review"
              >
                Reviewed
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {REPORT_RESOLUTIONS.map((r) => (
                <DropdownMenuItem
                  key={r}
                  onSelect={() => resolve.mutate({ reportId: row.original.id, resolution: r })}
                  data-testid={`report-resolve-${r}`}
                >
                  {REPORT_RESOLUTION_LABELS[r]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [formatDateTime, now, resolve],
  );
  if (q.error && trpcErrorCode(q.error) === "NOT_FOUND") notFound();
  const counts = q.data?.counts;
  return (
    <StudioFrame
      title="Reports"
      lede={`Every report is reviewed within ${REPORT_RESPONSE_TARGET_HOURS} hours of arriving. Oldest first.`}
      viewer={viewer}
    >
      <div className="flex flex-col gap-gutter" data-testid="reports-queue">
        <Panel
          title="Open reports"
          loading={q.isLoading}
          error={q.error ? errorMessage(q.error) : undefined}
          onRetry={() => void q.refetch()}
          actions={
            counts ? (
              <StatusPill tone={counts.overdue ? "bad" : "neutral"}>
                {counts.overdue
                  ? `${counts.open} open, ${counts.overdue} overdue`
                  : `${counts.open} open`}
              </StatusPill>
            ) : undefined
          }
          empty={
            q.data && q.data.reports.length === 0
              ? {
                  icon: ShieldAlert,
                  title: "Nothing to review",
                  children: "New reports appear here.",
                }
              : undefined
          }
        >
          {q.data && q.data.reports.length ? (
            <DataTable<Row>
              aria-label="Open reports"
              data={q.data.reports}
              columns={columns}
              getRowId={(r) => r.id}
              hideFilter
              className="border-0"
            />
          ) : null}
        </Panel>
      </div>
    </StudioFrame>
  );
}
