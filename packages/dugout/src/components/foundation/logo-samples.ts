/**
 * Sample business logos for stories and tests: sanitised SVG marks as `data:` URLs, the form `business.logo.get` returns.
 * Not part of the barrel; stories and tests import this file directly.
 */
const toDataUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;
const mark = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">${body}</svg>`;

export const SAMPLE_LOGOS = {
  /** An orbit on an ink tile (Ledgerly's colours). */
  orbit: toDataUrl(mark('<rect width="100" height="100" rx="22" fill="#0f1318"/><circle cx="50" cy="50" r="26" fill="none" stroke="#1f6f5f" stroke-width="9"/><circle cx="69.9" cy="33.3" r="9" fill="#e8c56b" stroke="#0f1318" stroke-width="3"/>')),
  /** Stacked bars on a paper tile (Northwind's colours). */
  stack: toDataUrl(mark('<rect width="100" height="100" rx="22" fill="#f6f4ef"/><rect x="20" y="25" width="60" height="13" rx="6.5" fill="#2b6cb0"/><rect x="20" y="43.5" width="46" height="13" rx="6.5" fill="#f5b841"/><rect x="20" y="62" width="34" height="13" rx="6.5" fill="#2b6cb0"/>')),
  /** A fold on the primary (Aurora's colours). */
  fold: toDataUrl(mark('<rect width="100" height="100" rx="22" fill="#7a3b8f"/><polygon points="22,30 58,22 58,78 22,70" fill="#ffffff" fill-opacity="0.92"/><polygon points="42,22 78,30 78,70 42,78" fill="#f29e4c" fill-opacity="0.9"/>')),
  /** A transparent upload: a dark glyph with no tile (it sits on the white image tile). */
  glyph: toDataUrl(mark('<path d="M20 80 L50 20 L80 80 Z" fill="none" stroke="#0f1318" stroke-width="10" stroke-linejoin="round"/>')),
} as const;
