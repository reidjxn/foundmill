"use client";
/**
 * Distribution › First ten (WP-08 T5): ten slots for the first conversations. The founder adds a person they know,
 * copies a message to send themselves, and writes down what the person said. Nothing here sends anything, asks a
 * model, or counts anyone as behind: an empty slot is just an empty slot. A person's stage moves by hand; saved words
 * move "To ask" or "Asked" to "Talked". Never an outcome of the project: a founder's own note is not one.
 */
import { useCallback, useState } from "react";
import { Check, Copy, UserPlus } from "lucide-react";
import { Button, Input, Panel, SimpleSelect, Textarea } from "@foundmill/dugout";
import { FIRST_TEN_NAME_MAX, FIRST_TEN_SLOTS, FIRST_TEN_STAGES, FIRST_TEN_STAGE_LABELS, FIRST_TEN_WORDS, FIRST_TEN_WORDS_MAX, firstTenMessage, isFirstTenStage, type FirstTenStage } from "@foundmill/shared/first-ten";
import { useBusinessEvents, useWidgetQuery } from "@foundmill/widgets/data";
import type { ModuleScreenProps } from "../registry";
import { InlineError, Screen, useAction } from "./shared";

interface FirstTenPerson {
  entityId: string;
  name: string;
  stage: string;
  words: string | null;
  updatedAt: string;
}
interface FirstTenList {
  people: FirstTenPerson[];
  counts: Record<FirstTenStage, number>;
}
/** What the screen reads of `page.get`: the project's one line, for the message. */
interface PageForMessage {
  published: { pitch: string } | null;
  preview: { name: string };
}

export function FirstTenScreen(_props: ModuleScreenProps) {
  const list = useWidgetQuery<FirstTenList>("crm.firstTen.list", {});
  const page = useWidgetQuery<PageForMessage>("page.get", {});
  const action = useAction();
  const [name, setName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  useBusinessEvents(() => list.refetch(), []);

  const oneLine = page.data?.published?.pitch || page.data?.preview.name || "";
  const people = list.data?.people ?? [];
  const run = useCallback(
    async (path: string, input: Record<string, unknown>, key: string) => {
      const ok = await action.run(path, input, { key });
      if (ok !== undefined) list.refetch();
      return ok !== undefined;
    },
    [action, list],
  );
  const add = async () => {
    if (!name.trim()) return;
    if (await run("crm.firstTen.add", { name: name.trim() }, "add")) setName("");
  };
  const copy = async (p: FirstTenPerson) => {
    try {
      await navigator.clipboard.writeText(firstTenMessage({ name: p.name, oneLine }));
      setCopied(p.entityId);
    } catch {
      // No clipboard in this browser: nothing is lost, the button just does nothing.
    }
  };
  const slots = Math.max(FIRST_TEN_SLOTS, people.length);

  return (
    <Screen name="distribution/first-ten">
      <Panel title={FIRST_TEN_WORDS.title} span={12} loading={list.isLoading} error={list.error ? list.error.message : undefined} onRetry={list.refetch} flush>
        <InlineError error={action.error} className="px-panel-pad pt-2" />
        <div className="flex flex-col gap-3 p-panel-pad">
          {people.length === 0 && list.data ? <p className="text-small text-secondary">{FIRST_TEN_WORDS.empty}</p> : null}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <Input value={name} maxLength={FIRST_TEN_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={FIRST_TEN_WORDS.namePlaceholder} aria-label={FIRST_TEN_WORDS.namePlaceholder} />
            <Button type="submit" size="sm" variant="primary" icon={UserPlus} loading={action.pending === "add"} disabled={!name.trim()}>
              {FIRST_TEN_WORDS.add}
            </Button>
          </form>
          <ol className="flex flex-col gap-2" aria-label="First ten">
            {Array.from({ length: slots }, (_, i) => {
              const p = people[i];
              return p ? <PersonSlot key={p.entityId} index={i + 1} person={p} copied={copied === p.entityId} pending={action.pending} onCopy={() => void copy(p)} onStage={(stage) => void run("crm.firstTen.move", { entityId: p.entityId, stage }, `move:${p.entityId}`)} onHeard={(words) => run("crm.firstTen.heard", { entityId: p.entityId, words }, `heard:${p.entityId}`)} /> : (
                <li key={`empty-${i}`} className="flex items-center gap-2 rounded-sm border border-dashed border-border px-3 py-2 text-small text-tertiary" data-slot="empty">
                  <span className="t-mono">{i + 1}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </Panel>
    </Screen>
  );
}

function PersonSlot({ index, person, copied, pending, onCopy, onStage, onHeard }: { index: number; person: FirstTenPerson; copied: boolean; pending: string | null; onCopy: () => void; onStage: (s: FirstTenStage) => void; onHeard: (words: string) => Promise<boolean> }) {
  const [words, setWords] = useState("");
  const stage = isFirstTenStage(person.stage) ? person.stage : "to_ask";
  return (
    <li className="surface-panel flex flex-col gap-2 p-3" data-person={person.entityId} data-stage={stage}>
      <div className="flex items-center gap-2">
        <span className="t-mono text-tertiary">{index}</span>
        <span className="min-w-0 flex-1 truncate text-body-strong text-primary">{person.name}</span>
        <SimpleSelect aria-label={`Stage: ${person.name}`} options={FIRST_TEN_STAGES.map((s) => ({ value: s, label: FIRST_TEN_STAGE_LABELS[s] }))} value={stage} onValueChange={(v) => isFirstTenStage(v) && onStage(v)} />
        <Button size="sm" variant="ghost" icon={copied ? Check : Copy} onClick={onCopy} aria-label={`${FIRST_TEN_WORDS.copy}: ${person.name}`}>
          {copied ? "Copied" : FIRST_TEN_WORDS.copy}
        </Button>
      </div>
      {person.words ? (
        <p className="whitespace-pre-line text-small text-secondary" data-testid="first-ten-words">
          {person.words}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <Textarea rows={2} maxLength={FIRST_TEN_WORDS_MAX} value={words} onChange={(e) => setWords(e.target.value)} placeholder={FIRST_TEN_WORDS.said} aria-label={`${FIRST_TEN_WORDS.said} ${person.name}`} />
        <Button size="sm" variant="tinted" loading={pending === `heard:${person.entityId}`} disabled={!words.trim()} onClick={() => void onHeard(words).then((ok) => ok && setWords(""))}>
          {FIRST_TEN_WORDS.save}
        </Button>
      </div>
    </li>
  );
}
