"use client";
/**
 * Report a person, a public profile or a message (docs/NETWORK.md F21; api `report.create`), with "Also block" in the
 * same step. Works from 390 px. The answer reads the same whatever was stored, so the toast always says the report went.
 * A post in a community keeps its own dialog (components/live/community-dialogs.tsx), which goes to its moderators.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_NAME } from "@foundmill/config";
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  RadioGroup,
  RadioOption,
  Textarea,
  useToast,
} from "@foundmill/dugout";
import {
  REPORT_NOTE_MAX,
  REPORT_REASON_LABELS,
  REPORT_REASONS,
  reportSentWords,
  type ReportReason,
} from "@foundmill/shared/reports";
import { errorMessage, trpcPathPrefix } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

export type ReportTarget =
  | { kind: "profile"; handle: string }
  | { kind: "person"; userId: string }
  | { kind: "message"; messageId: string };

const TITLES: Record<ReportTarget["kind"], string> = {
  profile: "Report this profile",
  person: "Report this person",
  message: "Report this message",
};

export function ReportPersonDialog({
  target,
  name,
  onOpenChange,
  onBlocked,
}: {
  target: ReportTarget | null;
  name: string;
  onOpenChange: (open: boolean) => void;
  onBlocked?: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [block, setBlock] = useState(false);
  useEffect(() => {
    if (!target) {
      setReason("spam");
      setNote("");
      setBlock(false);
    }
  }, [target]);
  const words = reportSentWords(APP_NAME);
  const report = useMutation(
    trpc.report.create.mutationOptions({
      onSuccess: (result) => {
        if (result.blocked) {
          void qc.invalidateQueries({ queryKey: trpcPathPrefix("live") as unknown[] });
          onBlocked?.();
        }
        toast({
          title: words.title,
          description: result.blocked ? `${words.body} ${words.blocked}` : words.body,
          tone: "info",
        });
        onOpenChange(false);
      },
      onError: (err) =>
        toast({ title: "Report not sent", description: errorMessage(err), tone: "bad" }),
    }),
  );
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="report-person-dialog">
        <DialogHeader>
          <DialogTitle>{target ? TITLES[target.kind] : "Report"}</DialogTitle>
          <DialogDescription>
            {name ? `About ${name}. ` : ""}
            {APP_NAME} reviews it. They are not told who reported them.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <RadioGroup
            value={reason}
            onValueChange={(v) => setReason(v as ReportReason)}
            aria-label="Why"
            className="flex flex-col gap-2"
          >
            {REPORT_REASONS.map((r) => (
              <RadioOption
                key={r}
                id={`report-person-${r}`}
                value={r}
                label={REPORT_REASON_LABELS[r]}
              />
            ))}
          </RadioGroup>
          <Field htmlFor="report-person-note" label="Anything we should know" hint="Optional.">
            <Textarea
              id="report-person-note"
              rows={2}
              maxLength={REPORT_NOTE_MAX}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <label
            htmlFor="report-person-block"
            className="flex min-h-tap items-center gap-2 text-body text-primary"
          >
            <Checkbox
              id="report-person-block"
              checked={block}
              onCheckedChange={(v) => setBlock(v === true)}
              data-testid="report-person-block"
            />
            Also block {name || "them"}: they cannot ask to connect or message you
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" className="min-h-tap" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            className="min-h-tap"
            icon={Flag}
            loading={report.isPending}
            onClick={() =>
              target && report.mutate({ target, reason, note: note.trim() || undefined, block })
            }
            data-testid="report-person-send"
          >
            Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
