"use client";
/**
 * Settings › Business (BUILD §11.15): name, slug, archetype and the currency the business keeps its money in (0025);
 * the logo (upload a real one, generate marks, or go back to the initials mark: `business.logo.*`, owner/admin, saved at
 * once and audited); the brand colours (saved with the rest of the form, with a suggestion read from the logo); and the time zone the business counts its days in
 * (`business.setTimeZone`, saved at once; audit #196).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Field, Input, SimpleSelect, type Kit } from "@foundmill/dugout";
import { ARCHETYPES, ARCHETYPE_LABELS, CURRENCIES, type Archetype } from "@foundmill/shared/constants";
import { timeZoneLabel, timeZoneNames } from "@foundmill/shared/time-zone";
import { LogoPicker, type LogoActions } from "@/components/logo/LogoPicker";
import { readLogoStream } from "@/components/logo/logo-stream";
import { useBusinessLogoSrc } from "@/components/logo/useBusinessLogo";
import { currencyName } from "@/lib/format";
import type { LogoDraft } from "@/lib/logo";
import { trpcErrorCode, type RouterOutputs } from "@/lib/trpc";
import { useTRPC, useTRPCClient } from "@/lib/trpc-react";
import { useBusiness } from "@/components/shell/business-context";
import { useInvalidateRouters } from "./SettingsScreen";
import { AdminOnly, FormRow, Hint, SaveBar, SettingsSection, useSettingsToast } from "./shared";
import { businessFields, businessSavePayload, changedFields, initialBusinessForm, rebaseBusinessForm, type BusinessFields } from "./business-form";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** The zones to pick from: UTC, then every zone the browser knows, with the business's own kept when it is not listed. */
export function timeZoneOptions(current: string | null | undefined): { value: string; label: string }[] {
  const names = timeZoneNames();
  const all = current && !names.includes(current) ? [current, ...names] : names;
  return all.map((z) => ({ value: z, label: timeZoneLabel(z) }));
}

export function BusinessTab() {
  const { businessId, data } = useBusiness();
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateRouters();
  const t = useSettingsToast();
  const b = data.business;
  // The form and the server values it started from; untouched fields follow the server copy as it changes (another tab,
  // a co-founder: `business.updated` refetches it), and a save sends only what changed (business-form.ts).
  const server = useMemo(() => businessFields(b), [b]);
  const [state, setState] = useState(() => initialBusinessForm(server));
  useEffect(() => setState((s) => rebaseBusinessForm(s, server)), [server]);
  const { name, slug, kitPrimary: primary, kitSecondary: secondary } = state.form;
  const archetype = (state.form.archetype ?? "") as Archetype | "";
  const set = (patch: Partial<BusinessFields>) => setState((s) => ({ ...s, form: { ...s.form, ...patch } }));
  const currencyOptions = useMemo(() => [...new Set([...CURRENCIES, state.base.currency])].map((c) => ({ value: c, code: c, label: currencyName(c), textValue: c })), [state.base.currency]);
  const setPrimary = (kitPrimary: string) => set({ kitPrimary });
  const setSecondary = (kitSecondary: string) => set({ kitSecondary });

  const update = useMutation(
    trpc.business.update.mutationOptions({
      onSuccess: (saved) => {
        // The saved values are the new starting point (no stale `expected` on the next save).
        setState(initialBusinessForm(businessFields(saved)));
        void invalidate(["business"]);
        t.saved("Business saved", "The top bar and the initials mark follow the new brand colors.");
      },
      onError: (e) => {
        // Someone changed a field this save changes: show the latest values, the founder decides again.
        if (trpcErrorCode(e) === "CONFLICT") {
          void queryClient.fetchQuery(trpc.business.get.queryOptions({ businessId }, { staleTime: 0 })).then((fresh) => setState(initialBusinessForm(businessFields(fresh.business))));
          t.failed(e, "Changed elsewhere");
          return;
        }
        t.failed(e);
      },
    }),
  );

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

  // --- the time zone: saved at once (business.setTimeZone, owner/admin, audited) ------------------------------------
  const zones = useMemo(() => timeZoneOptions(b.timeZone), [b.timeZone]);
  const setZone = useMutation(
    trpc.business.setTimeZone.mutationOptions({
      onSuccess: () => {
        void invalidate(["business", "journey", "finance"]);
        t.saved("Time zone saved", "Home, the Journey and the top bar count days in it now.");
      },
      onError: (e) => t.failed(e, "Time zone not saved"),
    }),
  );

  const validHex = HEX_RE.test(primary) && HEX_RE.test(secondary);
  const dirty = changedFields(state).length > 0;

  return (
    <AdminOnly>
      <SettingsSection title="Identity">
        <FormRow>
          <Field htmlFor="biz-name" label="Name" required>
            <Input id="biz-name" value={name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />
          </Field>
          <Field htmlFor="biz-slug" label="Slug" hint="Lower-case letters, digits and dashes.">
            <Input id="biz-slug" mono value={slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} maxLength={80} invalid={!/^[a-z0-9-]+$/.test(slug)} />
          </Field>
        </FormRow>
        <Field htmlFor="biz-archetype" label="Archetype" hint="Drives the default departments, channels and the Board's first decisions.">
          <SimpleSelect id="biz-archetype" value={archetype} onValueChange={(v) => set({ archetype: v || null })} placeholder="Choose an archetype" options={ARCHETYPES.map((a) => ({ value: a, label: ARCHETYPE_LABELS[a] }))} />
        </Field>
        <Field htmlFor="biz-currency" label="Currency" hint="Cash, budgets, wage caps and plans read in it. Amounts already set keep their own currency; model costs stay in US dollars.">
          <SimpleSelect id="biz-currency" value={state.form.currency} onValueChange={(currency) => set({ currency })} options={currencyOptions} />
        </Field>
        <Field htmlFor="biz-time-zone" label="Time zone" hint="Home's today, week and month, the Journey's days and the top bar's date follow it. Saved as soon as you pick one.">
          <SimpleSelect id="biz-time-zone" value={b.timeZone ?? ""} onValueChange={(v) => setZone.mutate({ businessId, timeZone: v })} placeholder="UTC until you pick one" disabled={setZone.isPending} options={zones} />
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
          onUseColours={(k) => set({ kitPrimary: k.primary, kitSecondary: k.secondary })}
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
          onSave={() => {
            const { changes, expected } = businessSavePayload(state);
            update.mutate({ businessId, ...changes, archetype: changes.archetype as Archetype | null | undefined, expected });
          }}
          saving={update.isPending}
          disabled={!dirty || !validHex || name.trim().length === 0 || !/^[a-z0-9-]+$/.test(slug)}
        />
      </SettingsSection>
    </AdminOnly>
  );
}
