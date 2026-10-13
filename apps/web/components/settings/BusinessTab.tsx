"use client";
/**
 * Settings › Business (BUILD §11.15): name, slug and archetype; the logo (upload a real one, generate marks, or go back
 * to the initials mark: `business.logo.*`, owner/admin, saved at once and audited); and the brand colours (saved with
 * the rest of the form, with a suggestion read from the logo).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Field, Input, SimpleSelect, type Kit } from "@foundmill/dugout";
import { ARCHETYPES, ARCHETYPE_LABELS, type Archetype } from "@foundmill/shared/constants";
import { LogoPicker, type LogoActions } from "@/components/logo/LogoPicker";
import { readLogoStream } from "@/components/logo/logo-stream";
import { useBusinessLogoSrc } from "@/components/logo/useBusinessLogo";
import type { LogoDraft } from "@/lib/logo";
import { fieldConflictOf, type RouterOutputs } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, FormRow, Hint, SaveBar, SettingsSection, useSettingsToast } from "./shared";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** The message under the Slug field: the API's "That slug is taken" while the field still holds the refused slug. */
export function slugFieldError(slug: string, taken: { slug: string; message: string } | null): string | undefined {
  return taken && taken.slug === slug ? taken.message : undefined;
}

export function BusinessTab() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const b = data.business;
  const [name, setName] = useState(b.name);
  const [slug, setSlug] = useState(b.slug);
  const [archetype, setArchetype] = useState<Archetype | "">(b.archetype ?? "");
  const [primary, setPrimary] = useState(b.kitPrimary);
  const [secondary, setSecondary] = useState(b.kitSecondary);
  // The slug the API refused because another business has it, with its message, shown under the field until it changes.
  const [takenSlug, setTakenSlug] = useState<{ slug: string; message: string } | null>(null);

  const update = useMutation(
    trpc.business.update.mutationOptions({
      onSuccess: () => {
        void invalidate(["business"]);
        t.saved("Business saved", "The top bar and the initials mark follow the new brand colors.");
      },
      onError: (e, vars) => {
        const conflict = fieldConflictOf(e);
        if (conflict?.field === "slug" && vars.slug) setTakenSlug({ slug: vars.slug, message: conflict.message });
        else t.failed(e);
      },
    }),
  );
  const slugError = slugFieldError(slug, takenSlug);

  // --- the logo: saved at once (business.logo.*) ----------------------------------------------------------------------
  const meta = data.logo;
  const logoSrc = useBusinessLogoSrc(businessId, meta);
  const current = useMemo<LogoDraft | null>(() => (meta && logoSrc ? { source: meta.source, dataUrl: logoSrc, colours: [], label: "" } : null), [meta, logoSrc]);
  const [pending, setPending] = useState<LogoDraft | null | undefined>(undefined);
  const prepare = useMutation(trpc.business.logo.prepare.mutationOptions());
  const upload = useMutation(trpc.business.logo.upload.mutationOptions());
  const remove = useMutation(trpc.business.logo.remove.mutationOptions());
  const { mutateAsync: prepareAsync } = prepare;
  const kit: Kit = { primary: HEX_RE.test(primary) ? primary : b.kitPrimary, secondary: HEX_RE.test(secondary) ? secondary : b.kitSecondary };
  const actions = useMemo<LogoActions>(
    () => ({
      prepare: (dataUrl) => prepareAsync({ businessId, dataUrl }),
      // Streamed: each mark shows the moment it passes the server's check (audit P6).
      generate: async (round, onProgress, signal) => readLogoStream(await client.business.logo.stream.mutate({ businessId, colours: kit, round }, { signal }), onProgress),
    }),
    // The colours a new set uses are the ones on screen, saved or not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [businessId, prepareAsync, client, kit.primary, kit.secondary],
  );

  async function saveLogo(draft: LogoDraft | null) {
    setPending(draft);
    try {
      if (draft) {
        const res = await upload.mutateAsync({ businessId, source: draft.source, dataUrl: draft.dataUrl });
        // Seed the image under its new version so the top bar swaps without another fetch.
        const image: RouterOutputs["business"]["logo"]["get"] = { ...res.logo, dataUrl: res.dataUrl };
        queryClient.setQueryData(trpc.business.logo.get.queryKey({ businessId, version: res.logo.sha256 }), image);
        t.saved("Logo saved", "The top bar shows it now.");
      } else {
        await remove.mutateAsync({ businessId });
        t.saved("Logo removed", "The initials mark stands in until you add one.");
      }
      await invalidate(["business"]);
    } catch (err) {
      t.failed(err, "Logo not saved");
      throw err;
    } finally {
      setPending(undefined);
    }
  }

  const validHex = HEX_RE.test(primary) && HEX_RE.test(secondary);
  const dirty = name !== b.name || slug !== b.slug || (archetype || null) !== (b.archetype ?? null) || primary !== b.kitPrimary || secondary !== b.kitSecondary;

  return (
    <AdminOnly>
      <SettingsSection title="Identity">
        <FormRow>
          <Field htmlFor="biz-name" label="Name" required>
            <Input id="biz-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <Field htmlFor="biz-slug" label="Slug" hint="Lower-case letters, digits and dashes." error={slugError}>
            <Input id="biz-slug" mono value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={80} invalid={!!slugError || !/^[a-z0-9-]+$/.test(slug)} data-testid="business-slug" />
          </Field>
        </FormRow>
        <Field htmlFor="biz-archetype" label="Archetype" hint="Drives the default departments, channels and the Board's first decisions.">
          <SimpleSelect id="biz-archetype" value={archetype} onValueChange={(v) => setArchetype(v as Archetype)} placeholder="Choose an archetype" options={ARCHETYPES.map((a) => ({ value: a, label: ARCHETYPE_LABELS[a] }))} />
        </Field>
      </SettingsSection>
      <SettingsSection title="Logo and brand colors" data-testid="settings-logo">
        <LogoPicker
          name={name || b.name}
          kit={kit}
          value={pending !== undefined ? pending : current}
          onChange={saveLogo}
          actions={actions}
          saving={pending !== undefined}
          onUseColours={(k) => {
            setPrimary(k.primary);
            setSecondary(k.secondary);
          }}
        />
        <FormRow>
          <Field htmlFor="kit-primary" label="Primary color" error={HEX_RE.test(primary) ? undefined : "Use a 6-digit hex color"}>
            <Input id="kit-primary" mono value={primary} onChange={(e) => setPrimary(e.target.value)} trailing={<span aria-hidden className="inline-block size-4 rounded-xs ring-1 ring-line-strong" style={{ background: HEX_RE.test(primary) ? primary : "transparent" }} />} data-testid="kit-primary-hex" />
          </Field>
          <Field htmlFor="kit-secondary" label="Secondary color" error={HEX_RE.test(secondary) ? undefined : "Use a 6-digit hex color"}>
            <Input id="kit-secondary" mono value={secondary} onChange={(e) => setSecondary(e.target.value)} trailing={<span aria-hidden className="inline-block size-4 rounded-xs ring-1 ring-line-strong" style={{ background: HEX_RE.test(secondary) ? secondary : "transparent" }} />} data-testid="kit-secondary-hex" />
          </Field>
        </FormRow>
        <Hint>The logo is saved as soon as you choose it. Brand colors are saved with the button below; text on the primary color is picked for you so it always stays readable.</Hint>
        <SaveBar
          onSave={() => update.mutate({ businessId, name: name.trim(), slug, archetype: archetype || null, kitPrimary: primary, kitSecondary: secondary })}
          saving={update.isPending}
          disabled={!dirty || !validHex || name.trim().length === 0 || !/^[a-z0-9-]+$/.test(slug) || !!slugError}
        />
      </SettingsSection>
    </AdminOnly>
  );
}
