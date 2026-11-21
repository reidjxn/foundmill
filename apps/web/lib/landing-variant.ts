/**
 * Which landing page a signed-out visitor gets at `/` (founder, 2026-11-16; DESIGN §9a "Variants"). One page, five sets
 * of words: the first-timer's (the default) and one each for a visitor with no idea yet, one who has an idea or a plan,
 * one who already runs something, and one who wants to build an app. Each is prerendered at `/lp/<id>` and served
 * under `/` by proxy.ts, so the address stays as the visitor typed it and the page stays static.
 *
 * What chooses, in order: the link's own `?lp=<id>` (a campaign link names its page), then the page this browser was
 * given before (`fm_lp`, so a returning visitor sees one page), then the channel the link names (`utm_source`). Pure:
 * no cookie or request is read here. An experiment that splits traffic assigns `fm_lp` the same way.
 */
/**
 * One page per ideal founder profile (founder, 2026-11-19), each also at its number: `/1` is the first-timer's page and
 * `/2` to `/20` these, in this order (`NUMBERED_LANDING_PAGES`). The profile behind each is in the variant's comment in
 * components/landing/words.ts.
 */
export const PROFILE_VARIANTS = [
  "student", "graduate", "blank-box", "overwhelmed", "evenings", "parent", "expert", "trades", "retired", "maker",
  "cook", "creator", "freelancer", "developer", "game-dev", "educator", "beauty", "shop-owner", "idea-collector",
] as const;
export const LANDING_VARIANTS = ["first", "no-idea", "has-idea", "running", "builder", "calls", "team", ...PROFILE_VARIANTS] as const;
export type LandingVariant = (typeof LANDING_VARIANTS)[number];

export const DEFAULT_LANDING_VARIANT: LandingVariant = "first";
export const LANDING_VARIANT_PARAM = "lp";
export const LANDING_VARIANT_COOKIE = "fm_lp";
/** How long a browser keeps its page: 30 days, like the first-touch reference (`fm_via`). */
export const LANDING_VARIANT_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * The page a channel gets when its link names no page (`utm_source`, lowercased). Only channels whose readers are
 * known belong here; every other channel gets the default. Add a line when a campaign starts.
 */
export const CHANNEL_VARIANTS: Readonly<Record<string, LandingVariant>> = {
  github: "builder",
  hackernews: "builder",
  producthunt: "builder",
};

export function isLandingVariant(value: string | null | undefined): value is LandingVariant {
  return !!value && (LANDING_VARIANTS as readonly string[]).includes(value);
}

/** The page the link itself asks for: its `lp`, else its channel's. Null when the link says nothing. */
export function landingVariantSignal(search: string): LandingVariant | null {
  const params = new URLSearchParams(search);
  const named = params.get(LANDING_VARIANT_PARAM);
  if (isLandingVariant(named)) return named;
  return CHANNEL_VARIANTS[(params.get("utm_source") ?? "").trim().toLowerCase()] ?? null;
}

/** The page to serve: what the link asks for, else what this browser was given before, else the default. */
export function landingVariant(search: string, remembered: string | null | undefined): LandingVariant {
  return landingVariantSignal(search) ?? (isLandingVariant(remembered) ? remembered : DEFAULT_LANDING_VARIANT);
}

/** The route that serves a variant under `/`; null for the default, which is `/` itself. */
export function landingVariantRoute(variant: LandingVariant): string | null {
  return variant === DEFAULT_LANDING_VARIANT ? null : `/lp/${variant}`;
}

/** The pages at `/1` to `/20`: index 0 is `/1`. */
export const NUMBERED_LANDING_PAGES: readonly LandingVariant[] = [DEFAULT_LANDING_VARIANT, ...PROFILE_VARIANTS];

/** The variant a numbered address (`/7`) names, or null for any other path. */
export function numberedLandingVariant(pathname: string): LandingVariant | null {
  const n = /^\/([1-9]\d?)$/.exec(pathname)?.[1];
  return n ? (NUMBERED_LANDING_PAGES[Number(n) - 1] ?? null) : null;
}
