"use client";
/**
 * Email with this person on their profile (WP-08 T2): what they wrote to the project's Foundmill address, kept as plain
 * text, and the founders' answers, oldest first, with one box to answer the latest reply. A stranger wrote the text:
 * it is rendered as text only (never Markdown, never an entity link, links not clickable). Nothing shows for a record
 * with no kept email.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { Mail, Send } from "lucide-react";
import { useState } from "react";
import { Button, Chip, Icon, Panel, Textarea, useFormatters, useToast } from "@foundmill/dugout";
import { REPLY_ANSWER_MAX, REPLY_WORDS } from "@foundmill/shared/replies";
import { errorMessage } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

export function ReplyThread({ businessId, entityId }: { businessId: string; entityId: string }) {
  const trpc = useTRPC();
  const { toast } = useToast();
  const { formatDateTime } = useFormatters();
  const [draft, setDraft] = useState("");
  // One id per answer written: pressing Send again (after a timeout) never sends it twice (the gateway checks it).
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const listQ = useQuery(trpc.crm.replies.list.queryOptions({ businessId, entityId, limit: 50 }, { staleTime: 10_000 }));
  const answer = useMutation(
    trpc.crm.replies.answer.mutationOptions({
      onSuccess: (r) => {
        if (r.sent && !r.simulated) {
          setDraft("");
          setRequestId(crypto.randomUUID());
        }
        toast({ title: r.sent && !r.simulated ? REPLY_WORDS.sent : "Not sent", description: r.sent && !r.simulated ? undefined : r.message, tone: r.sent && !r.simulated ? "good" : "warn" });
        void listQ.refetch();
      },
      onError: (err) => toast({ title: "Not sent", description: errorMessage(err), tone: "bad" }),
    }),
  );
  const messages = [...(listQ.data ?? [])].reverse();
  if (messages.length === 0) return null;
  const latest = [...messages].reverse().find((m) => m.direction === "inbound");
  return (
    <Panel title={REPLY_WORDS.threadTitle} span={12} footer={REPLY_WORDS.plainNote} data-testid="reply-thread">
      <ul className="flex flex-col gap-3">
        {messages.map((m) => (
          <li key={m.id} className="flex flex-col gap-0.5" data-testid="reply-message" data-direction={m.direction}>
            <span className="inline-flex flex-wrap items-center gap-2 text-small text-secondary">
              <Icon icon={Mail} size="inline" />
              {m.direction === "inbound" ? m.from : REPLY_WORDS.answerFrom} · {formatDateTime(m.receivedAt)}
              {m.answered ? <Chip tone="good">{REPLY_WORDS.answered}</Chip> : null}
            </span>
            {m.subject ? <span className="text-body text-primary">{m.subject}</span> : null}
            <p className="t-reading max-w-reading whitespace-pre-wrap break-words text-primary" data-testid="reply-text">
              {m.text}
            </p>
          </li>
        ))}
      </ul>
      {latest ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) answer.mutate({ businessId, interactionId: latest.id, text: draft.trim(), requestId });
          }}
        >
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={REPLY_ANSWER_MAX} aria-label={REPLY_WORDS.answerLabel} placeholder={REPLY_WORDS.answerLabel} data-testid="reply-answer" />
          <Button type="submit" variant="primary" icon={Send} className="self-end" disabled={!draft.trim()} loading={answer.isPending} data-testid="reply-send">
            {REPLY_WORDS.answerButton}
          </Button>
        </form>
      ) : null}
    </Panel>
  );
}
