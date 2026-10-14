/**
 * Settings › Business form state (audit RES-07, RUI-08). The form remembers the server values it started from (`base`):
 * - a save sends only the fields the founder changed, with the values they were changed from (`expected`), so a
 *   co-founder's rename is never written back by a color-only save, and a stale edit of the same field is refused;
 * - when the server copy changes (another tab, a co-founder, `business.updated` on the stream), fields the founder has
 *   not touched follow it, and touched ones keep the founder's edit.
 * Pure, so it is unit-tested.
 */
export interface BusinessFields {
  name: string;
  slug: string;
  archetype: string | null;
  kitPrimary: string;
  kitSecondary: string;
  currency: string;
}

export const BUSINESS_FIELD_KEYS = ["name", "slug", "archetype", "kitPrimary", "kitSecondary", "currency"] as const satisfies readonly (keyof BusinessFields)[];

export interface BusinessFormState {
  form: BusinessFields;
  base: BusinessFields;
}

export function businessFields(b: { name: string; slug: string; archetype?: string | null; kitPrimary: string; kitSecondary: string; currency: string }): BusinessFields {
  return { name: b.name, slug: b.slug, archetype: b.archetype ?? null, kitPrimary: b.kitPrimary, kitSecondary: b.kitSecondary, currency: b.currency };
}

export function initialBusinessForm(server: BusinessFields): BusinessFormState {
  return { form: { ...server }, base: { ...server } };
}

/** The fields the founder changed (name compared trimmed). */
export function changedFields(state: BusinessFormState): (keyof BusinessFields)[] {
  return BUSINESS_FIELD_KEYS.filter((k) => (k === "name" ? state.form.name.trim() !== state.base.name : state.form[k] !== state.base[k]));
}

/** The server copy changed: untouched fields follow it; touched ones keep the edit (and the value it was made from). */
export function rebaseBusinessForm(state: BusinessFormState, server: BusinessFields): BusinessFormState {
  const touched = new Set(changedFields(state));
  const form = { ...state.form };
  const base = { ...state.base };
  for (const k of BUSINESS_FIELD_KEYS) {
    if (touched.has(k)) continue;
    (form as Record<string, unknown>)[k] = server[k];
    (base as Record<string, unknown>)[k] = server[k];
  }
  return { form, base };
}

/** What a save sends: only the changed fields, and the values the form saw for them. */
export function businessSavePayload(state: BusinessFormState): { changes: Partial<BusinessFields>; expected: Partial<BusinessFields> } {
  const changes: Partial<BusinessFields> = {};
  const expected: Partial<BusinessFields> = {};
  for (const k of changedFields(state)) {
    (changes as Record<string, unknown>)[k] = k === "name" ? state.form.name.trim() : state.form[k];
    (expected as Record<string, unknown>)[k] = state.base[k];
  }
  return { changes, expected };
}
