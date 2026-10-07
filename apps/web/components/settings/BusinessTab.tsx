"use client";
/** Settings › Business: name, slug, archetype, crest preview and the brand colours (BUILD §11.15). */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Crest, Field, Input, SimpleSelect } from "@foundmill/dugout";
import { ARCHETYPES, ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared";
import { monogram } from "@/lib/format";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, FormRow, Hint, SaveBar, SettingsSection, useSettingsToast } from "./shared";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function BusinessTab() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const b = data.business;
  const [name, setName] = useState(b.name);
  const [slug, setSlug] = useState(b.slug);
  const [archetype, setArchetype] = useState<Archetype | "">(b.archetype ?? "");
  const [primary, setPrimary] = useState(b.kitPrimary);
  const [secondary, setSecondary] = useState(b.kitSecondary);

  const update = useMutation(
    trpc.business.update.mutationOptions({
      onSuccess: () => {
        void invalidate(["business"]);
        t.saved("Business saved", "The crest and kit bar follow the new colours.");
      },
      onError: (e) => t.failed(e),
    }),
  );

  const validHex = HEX_RE.test(primary) && HEX_RE.test(secondary);
  const dirty = name !== b.name || slug !== b.slug || (archetype || null) !== (b.archetype ?? null) || primary !== b.kitPrimary || secondary !== b.kitSecondary;

  return (
    <AdminOnly>
      <SettingsSection title="Identity">
        <FormRow>
          <Field htmlFor="biz-name" label="Name" required>
            <Input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <Field htmlFor="biz-slug" label="Slug" hint="Lower-case letters, digits and dashes.">
            <Input id="biz-slug" mono value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={80} invalid={!/^[a-z0-9-]+$/.test(slug)} />
          </Field>
        </FormRow>
        <Field htmlFor="biz-archetype" label="Archetype" hint="Drives the default departments, channels and the Board's first decisions.">
          <SimpleSelect id="biz-archetype" value={archetype} onValueChange={(v) => setArchetype(v as Archetype)} placeholder="Choose an archetype" options={ARCHETYPES.map((a) => ({ value: a, label: ARCHETYPE_LABELS[a] }))} />
        </Field>
      </SettingsSection>
      <SettingsSection title="Crest and brand colours">
        <div className="flex items-start gap-4">
          <Crest seed={b.slug || b.id} kitPrimary={HEX_RE.test(primary) ? primary : b.kitPrimary} kitSecondary={HEX_RE.test(secondary) ? secondary : b.kitSecondary} monogram={monogram(name || b.name)} size={96} title={`${name} crest`} />
          <div className="flex flex-1 flex-col gap-3">
            <FormRow>
              <Field htmlFor="kit-primary" label="Primary colour" error={HEX_RE.test(primary) ? undefined : "Use a 6-digit hex colour"}>
                <Input id="kit-primary" mono value={primary} onChange={(e) => setPrimary(e.target.value)} trailing={<span aria-hidden className="inline-block h-4 w-4 rounded-chip border border-subtle" style={{ background: HEX_RE.test(primary) ? primary : "transparent" }} />} />
              </Field>
              <Field htmlFor="kit-secondary" label="Secondary colour" error={HEX_RE.test(secondary) ? undefined : "Use a 6-digit hex colour"}>
                <Input id="kit-secondary" mono value={secondary} onChange={(e) => setSecondary(e.target.value)} trailing={<span aria-hidden className="inline-block h-4 w-4 rounded-chip border border-subtle" style={{ background: HEX_RE.test(secondary) ? secondary : "transparent" }} />} />
              </Field>
            </FormRow>
            <Hint>The crest is generated from the slug and these colours; text on the primary colour is computed for contrast (APCA Lc ≥ 75).</Hint>
          </div>
        </div>
        <SaveBar
          onSave={() => update.mutate({ businessId, name: name.trim(), slug, archetype: archetype || null, kitPrimary: primary, kitSecondary: secondary })}
          saving={update.isPending}
          disabled={!dirty || !validHex || name.trim().length === 0 || !/^[a-z0-9-]+$/.test(slug)}
        />
      </SettingsSection>
    </AdminOnly>
  );
}
