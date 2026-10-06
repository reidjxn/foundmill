/** The only place the product name lives (BUILD §0, §19). Every user-facing mention imports this. */
export const APP_NAME = "Foundmill" as const;
export const APP_TAGLINE = "Build a real business with a squad of AI agents." as const;
/** Canonical public origin of the product (apex domain purchased 2026-10-06). */
export const APP_DOMAIN = "foundmill.com" as const;
export const APP_ORIGIN = `https://${APP_DOMAIN}` as const;
