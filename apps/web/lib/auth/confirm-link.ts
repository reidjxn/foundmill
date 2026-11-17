/**
 * The sign-in email's link opens /auth/confirm on the app, carrying Supabase's own confirmation link as
 * `confirmation_url`; the page shows one button, and only a press on it opens that link. Supabase's email-template guide
 * ("Email prefetching"): some mail services, Microsoft 365's Safe Links among them, open every link in an email before the
 * reader does, and a one-time link opened that way is used up, so the person then sees "Link expired" (Nov 16, 2026: a new
 * founder's link was opened by a scanner 22 seconds after it was sent, two minutes before they tapped it).
 */

/** The query parameter the email template fills with `{{ .ConfirmationURL }}`. */
export const CONFIRMATION_URL_PARAM = "confirmation_url";

/** Supabase Auth's verify endpoint, the one address the button may open. */
const VERIFY_PATH = "/auth/v1/verify";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/**
 * The confirmation link the button opens, or null when the page has none or it points anywhere but this deployment's
 * own Supabase Auth (the page is never a way to send someone to another site).
 *
 * The template writes `{{ .ConfirmationURL }}` inside a query parameter. Supabase's template engine may percent-encode
 * it there (it arrives whole) or leave it as it is (its own `&type=…&redirect_to=…` then arrive as parameters of this
 * page), so parameters of this page other than `confirmation_url` are put back on the link.
 */
export function confirmationLink(params: SearchParams, supabaseUrl: string): string | null {
  const raw = first(params[CONFIRMATION_URL_PARAM]);
  if (!raw || !supabaseUrl) return null;
  let link: URL;
  let supabase: URL;
  try {
    link = new URL(raw);
    supabase = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (link.origin !== supabase.origin || link.pathname !== VERIFY_PATH) return null;
  for (const [key, value] of Object.entries(params)) {
    const v = first(value);
    if (key !== CONFIRMATION_URL_PARAM && v !== null && !link.searchParams.has(key)) link.searchParams.set(key, v);
  }
  return link.toString();
}
