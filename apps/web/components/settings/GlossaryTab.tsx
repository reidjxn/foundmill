"use client";
/** Settings › Glossary (BUILD §11.13): rename nouns everywhere; the Composer and commentary read the same map. */
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Icon, IconButton, Input } from "@foundmill/dugout";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SaveBar, SettingsSection, useSettingsToast } from "./shared";

export const SUGGESTED_TERMS = ["customer", "customers", "lead", "leads", "order", "orders", "signup", "subscription"] as const;

type Row = { id: number; term: string; replacement: string };

/**
 * Default words the product no longer uses (the founder's vocabulary rule, CLAUDE.md): a glossary saved before the
 * rename still keys on them, so the row shows, and saves, the word the product uses today.
 */
export const RETIRED_TERMS: Record<string, string> = { squad: "team", club: "business", crest: "logo", shout: "nudge", season: "chapter", trophy: "milestone", trophies: "milestones" };

export function glossaryRows(glossary: Record<string, string>): Row[] {
  return Object.entries(glossary).map(([term, replacement], id) => ({ id, term: RETIRED_TERMS[term.trim().toLowerCase()] ?? term, replacement }));
}

export function rowsToGlossary(rows: readonly Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const term = r.term.trim().toLowerCase();
    const rep = r.replacement.trim();
    if (term && rep) out[term] = rep;
  }
  return out;
}

export function GlossaryTab() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const [rows, setRows] = useState<Row[]>(() => glossaryRows(data.business.glossary ?? {}));
  const [nextId, setNextId] = useState(rows.length);
  const update = useMutation(trpc.business.update.mutationOptions({ onSuccess: () => (void invalidate(["business"]), t.saved("Glossary saved", "New notes use the new words.")), onError: (e) => t.failed(e) }));

  const add = (term = "") => {
    setRows((r) => [...r, { id: nextId, term, replacement: "" }]);
    setNextId((n) => n + 1);
  };
  const edit = (id: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const dirty = JSON.stringify(rowsToGlossary(rows)) !== JSON.stringify(rowsToGlossary(glossaryRows(data.business.glossary ?? {})));

  return (
    <AdminOnly>
      <SettingsSection title="Glossary">
        <Hint>Say “clients” instead of “customers”, “patients” instead of “leads”. Words are matched whole and in any case, in inbox notes, updates and panel captions.</Hint>
        <div className="flex flex-col gap-2" data-testid="glossary-rows">
          <div className="flex items-center gap-2">
            <span className="t-data flex-1">Default word</span>
            <span aria-hidden className="w-4 shrink-0" />
            <span className="t-data flex-1">Your word</span>
            <span aria-hidden className="w-control-sm shrink-0" />
          </div>
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <Input aria-label="Default word" wrapperClassName="flex-1" value={r.term} onChange={(e) => edit(r.id, { term: e.target.value })} placeholder="customer" list="glossary-terms" />
              <Icon icon={ArrowRight} size="inline" className="w-4 shrink-0 text-tertiary" />
              <Input aria-label="Your word" wrapperClassName="flex-1" value={r.replacement} onChange={(e) => edit(r.id, { replacement: e.target.value })} placeholder="client" />
              <IconButton label="Remove term" icon={Trash2} size="sm" onClick={() => setRows((cur) => cur.filter((x) => x.id !== r.id))} />
            </div>
          ))}
          <datalist id="glossary-terms">
            {SUGGESTED_TERMS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div>
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => add()}>
              Add term
            </Button>
          </div>
        </div>
        <SaveBar onSave={() => update.mutate({ businessId, glossary: rowsToGlossary(rows) })} saving={update.isPending} disabled={!dirty} />
      </SettingsSection>
    </AdminOnly>
  );
}
