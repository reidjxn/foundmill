"use client";
/** Settings › Glossary (BUILD §11.13): rename nouns everywhere; the Composer and commentary read the same map. */
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, IconButton, Input } from "@foundmill/dugout";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, Hint, SaveBar, SettingsSection, useSettingsToast } from "./shared";

export const SUGGESTED_TERMS = ["customer", "customers", "lead", "leads", "order", "orders", "signup", "subscription"] as const;

type Row = { id: number; term: string; replacement: string };

export function glossaryRows(glossary: Record<string, string>): Row[] {
  return Object.entries(glossary).map(([term, replacement], id) => ({ id, term, replacement }));
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
  const dirty = JSON.stringify(rowsToGlossary(rows)) !== JSON.stringify(data.business.glossary ?? {});

  return (
    <AdminOnly>
      <SettingsSection title="Glossary">
        <Hint>Say “clients” instead of “customers”, “patients” instead of “leads”. Terms are matched whole-word and case-insensitively in inbox notes, commentary and widget captions.</Hint>
        <div className="flex flex-col gap-2" data-testid="glossary-rows">
          <div className="grid grid-cols-[1fr_1fr_28px] gap-2 t-label">
            <span>Default word</span>
            <span>Your word</span>
            <span />
          </div>
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_1fr_28px] items-center gap-2">
              <Input aria-label="Default word" value={r.term} onChange={(e) => edit(r.id, { term: e.target.value })} placeholder="customer" list="glossary-terms" />
              <Input aria-label="Your word" value={r.replacement} onChange={(e) => edit(r.id, { replacement: e.target.value })} placeholder="client" />
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
