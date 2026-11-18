/**
 * The platform's own small pages on a site's host (WP-07 T4): the report form, its answer, the taken-down page and
 * plain errors. They carry no project text except what is escaped here, and no script.
 */

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const STYLE =
  "body{font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;margin:0;padding:24px 16px;color:#1f2328;background:#fff}" +
  "main{max-width:32rem;margin:0 auto}h1{font-size:1.4rem;margin:0 0 12px}label{display:block;margin:16px 0 4px;font-weight:600}" +
  "select,textarea{width:100%;box-sizing:border-box;font:inherit;padding:8px;border:1px solid #8c959f;border-radius:6px}" +
  "button{margin-top:16px;font:inherit;padding:8px 16px;border-radius:6px;border:1px solid #1f2328;background:#1f2328;color:#fff}" +
  "p{margin:0 0 12px}";

/** A complete platform page. `bodyHtml` is markup this module wrote; every outside value in it is escaped. */
export function platformPage(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${bodyHtml}</main></body></html>`;
}

export const REPORT_REASONS = [
  { value: "scam", label: "A scam or fraud" },
  { value: "phishing", label: "It asks for passwords or payment details" },
  { value: "illegal", label: "Illegal content" },
  { value: "offensive", label: "Hateful or abusive content" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

export const REPORT_DETAIL_MAX = 1000;

export function reportFormPage(): string {
  const options = REPORT_REASONS.map((r) => `<option value="${r.value}">${escapeHtml(r.label)}</option>`).join("");
  return platformPage(
    "Report this site",
    `<h1>Report this site</h1><p>Tell us what is wrong with this site. We read every report. We do not ask who you are.</p>` +
      `<form method="post" action="/_fm/report"><label for="reason">What is wrong</label><select id="reason" name="reason" required>${options}</select>` +
      `<label for="detail">Anything we should know (optional)</label><textarea id="detail" name="detail" rows="5" maxlength="${REPORT_DETAIL_MAX}"></textarea>` +
      `<button type="submit">Send report</button></form>`,
  );
}

export function reportAnswerPage(outcome: "recorded" | "limited" | "invalid"): string {
  if (outcome === "recorded") return platformPage("Report sent", "<h1>Thank you</h1><p>Your report was sent. We will look at this site.</p>");
  if (outcome === "limited") return platformPage("Try again later", "<h1>Try again later</h1><p>This site has had many reports in a short time. Please try again later.</p>");
  return platformPage("Report this site", `<h1>Choose a reason</h1><p>Pick what is wrong with the site, then send the report again.</p><p><a href="/_fm/report">Back to the report form</a></p>`);
}

export const SERVER_ERROR_PAGE = platformPage("Something went wrong", "<h1>Something went wrong</h1><p>This site could not be shown just now. Try again in a minute.</p>");

export const TAKEN_DOWN_PAGE = platformPage("No longer available", "<h1>This site is no longer available.</h1>");

export const NOT_FOUND_PAGE = platformPage("Not found", "<h1>Not found</h1><p>There is nothing at this address.</p>");

/**
 * The one footer the service adds to every HTML response, before `</body>`. Fixed text: no project text is in it.
 * `markHref` is the product's address when the project's plan shows the "Built on" mark, else null.
 */
export function siteFooter(appName: string, markHref: string | null): string {
  // Fixed to the bottom of the window, last in the document, every property !important (an inline !important declaration
  // beats a site stylesheet's): a site's CSS can neither hide it nor cover it with an overlay. Markup that would swallow
  // it (an unclosed comment, a raw-text or template element) is held by screening (packages/agents site-screen.ts).
  const link = "display:inline!important;visibility:visible!important;color:#24292f!important;text-decoration:underline!important;opacity:1!important;font:inherit!important";
  const box =
    "display:block!important;visibility:visible!important;opacity:1!important;position:fixed!important;left:0!important;right:0!important;bottom:0!important;" +
    "z-index:2147483647!important;clip-path:none!important;transform:none!important;filter:none!important;margin:0!important;" +
    "font:12px/1.4 system-ui,sans-serif!important;text-align:center!important;padding:6px 16px!important;color:#57606a!important;background:#f6f8fa!important;border-top:1px solid #d0d7de!important";
  // The mark reads one step larger than the bar's other text, so no notice on the page outranks it (founder, Nov 18, 2026).
  const markStyle = link.replace("font:inherit!important", "font:13px/1.4 system-ui,sans-serif!important");
  const mark = markHref ? ` · <a href="${escapeHtml(markHref)}" rel="noopener" style="${markStyle}">Built on ${escapeHtml(appName)}</a>` : "";
  // The spacer keeps the end of the page clear of the fixed bar.
  return `<div aria-hidden="true" style="height:40px!important;display:block!important"></div><div data-fm-footer style="${box}"><a href="/_fm/report" rel="nofollow" style="${link}">Report this site</a>${mark}</div>`;
}

/** `html` with the footer before its last `</body>`, or at the end when there is none. */
export function withFooter(html: string, footer: string): string {
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at < 0 ? `${html}${footer}` : `${html.slice(0, at)}${footer}${html.slice(at)}`;
}

/** The sign-up confirmation page (WP-07 T6): the address the visitor typed, the platform's own consent sentence with an
 * unticked box, the hidden field and the bot check. Never the agent's HTML, so a site cannot weaken or pre-tick consent. */
export function followFormPage(input: { email: string; consentText: string; turnstileSiteKey: string | null; mockToken: string | null }): string {
  const check = input.turnstileSiteKey
    ? `<div class="cf-turnstile" data-sitekey="${escapeHtml(input.turnstileSiteKey)}" data-action="page_follow"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : input.mockToken
      ? `<input type="hidden" name="cf-turnstile-response" value="${escapeHtml(input.mockToken)}">`
      : "";
  return platformPage(
    "Sign up",
    `<h1>Sign up</h1><form method="post" action="/_fm/follow/confirm">` +
      `<p>Your email address: <strong>${escapeHtml(input.email)}</strong></p><input type="hidden" name="email" value="${escapeHtml(input.email)}">` +
      `<p><label style="display:flex;gap:8px;align-items:flex-start;font-weight:400"><input type="checkbox" name="consent" value="yes" required> <span>${escapeHtml(input.consentText)}</span></label></p>` +
      `<div aria-hidden="true" style="position:absolute;left:-10000px"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>` +
      `${check}<button type="submit">Sign up</button></form>`,
  );
}

export const FOLLOW_CHECK_INBOX_PAGE = platformPage("Check your inbox", "<h1>Check your inbox</h1><p>We sent you an email. Open the link in it to confirm, and you are signed up.</p>");
export const FOLLOW_PREVIEW_PAGE = platformPage("Not published yet", "<h1>Not published yet</h1><p>Sign-ups open when the site is published.</p>");
export const followRefusedPage = (sentence: string): string => platformPage("Not signed up", `<h1>Not signed up yet</h1><p>${escapeHtml(sentence)}</p><p><a href="/">Back to the site</a></p>`);
