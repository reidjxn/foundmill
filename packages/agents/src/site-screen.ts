/**
 * Screening of a site release (WP-07 T5): deterministic rules only, no model call. A release that raises any flag is
 * `held`: never served, and the next session reads the flags and fixes them. apps/sites' response headers are what
 * enforce (no script runs whatever a release holds); screening exists so a bad release is held with a reason a person
 * and an agent can read, instead of a preview that looks broken.
 */
import { SITE_FILE_TYPES, SITE_LIMITS } from "@foundmill/shared/sites";
import { communityScreenLocalFlags } from "./community-screen";

export interface SiteFlag {
  rule: SiteRule;
  path: string;
  detail: string;
}

export type SiteRule =
  | "too_many_files"
  | "too_large"
  | "file_too_large"
  | "path"
  | "file_type"
  | "no_index"
  | "script"
  | "embed"
  | "meta_refresh"
  | "event_handler"
  | "unsafe_url"
  | "form_action"
  | "sensitive_input"
  | "link_scheme"
  | "payment_link"
  | "css_import"
  | "css_outside_url"
  | "swallows_footer"
  | "unreadable"
  | "markup_text"
  | "personal_data";

export interface SiteScreenFile {
  path: string;
  size: number;
  /** The file's text, for HTML, SVG and CSS. */
  text?: string;
}

/** The plain words a held release shows the founder ("Held back: <words>. The next round of work fixes it."). */
export const SITE_RULE_WORDS: Readonly<Record<SiteRule, string>> = {
  too_many_files: `more than ${SITE_LIMITS.maxFiles} files`,
  too_large: "the site is larger than 10 MB",
  file_too_large: "a file is larger than 2 MB",
  path: "a file name that cannot be served",
  file_type: "a kind of file sites cannot serve",
  no_index: "there is no home page (index.html)",
  script: "it contains a script",
  embed: "it embeds another site or plugin",
  meta_refresh: "it sends visitors somewhere else automatically",
  event_handler: "it contains code in an attribute",
  unsafe_url: "a link that runs code",
  form_action: "a form that sends somewhere other than the sign-up",
  sensitive_input: "it asks for a password or payment details",
  link_scheme: "a link that is not a web address, an email address or a page of the site",
  payment_link: "it links straight to a payment page; use a pay button",
  css_import: "a stylesheet that loads another stylesheet",
  css_outside_url: "a stylesheet that loads files from another site",
  swallows_footer: "markup that would hide the platform's footer",
  unreadable: "a page the platform could not read",
  markup_text: "code shown as text on the page",
  personal_data: "a phone number or similar personal detail",
};

const extOf = (path: string): string => {
  const dot = path.lastIndexOf(".");
  return dot < 0 || dot < path.lastIndexOf("/") ? "" : path.slice(dot).toLowerCase();
};

const SIGNUP_ACTION = "/_fm/follow";
/** Hosted payment pages (the hosts pay links may point at; WP-07 D4: Stripe only at first). */
const PAYMENT_HOSTS = /^(?:https?:)?\/\/(?:buy|checkout)\.stripe\.com(?:[/:?#]|$)/i;
const ATTR = (name: string) => new RegExp(String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`, "gi");
const attrValues = (tag: string, name: string): string[] => [...tag.matchAll(ATTR(name))].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").trim());
const tagsOf = (html: string, name: string): string[] => html.match(new RegExp(String.raw`<\s*${name}\b[^>]*>`, "gi")) ?? [];

/** A link target a site may hold: https, mailto, a fragment or a path on the site itself. */
function linkProblem(url: string): boolean {
  // eslint-disable-next-line no-control-regex
  const u = url.replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
  if (u === "" || u.startsWith("#") || u.startsWith("mailto:") || u.startsWith("https://")) return false;
  if (u.startsWith("//")) return true;
  return /^[a-z][a-z0-9+.-]*:/.test(u);
}

/** The text a visitor reads: tags, comments and style blocks removed, entities left as written. */
function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

function screenMarkup(path: string, html: string, isSvg: boolean): SiteFlag[] {
  const flags: SiteFlag[] = [];
  const flag = (rule: SiteRule, detail: string) => flags.push({ rule, path, detail });
  if (/<\s*script\b/i.test(html)) flag("script", "<script>");
  for (const tag of ["iframe", "object", "embed", "base", "frame", "applet"]) if (new RegExp(String.raw`<\s*${tag}\b`, "i").test(html)) flag("embed", `<${tag}>`);
  if (/<\s*meta\b[^>]*\bhttp-equiv\b/i.test(html)) flag("meta_refresh", "<meta http-equiv>");
  if (/<[^>]+\son[a-z]+\s*=/i.test(html)) flag("event_handler", "an on… attribute");
  if (/\b(?:java|vb)script\s*:|data\s*:\s*text\/html/i.test(html)) flag("unsafe_url", "javascript: or data:text/html");
  for (const form of tagsOf(html, "form")) {
    const actions = attrValues(form, "action");
    if (actions.length !== 1 || actions[0] !== SIGNUP_ACTION) flag("form_action", `a form with action ${actions[0] ? `"${actions[0]}"` : "missing"}`);
  }
  for (const input of tagsOf(html, "input")) {
    const type = attrValues(input, "type")[0]?.toLowerCase();
    const autocomplete = attrValues(input, "autocomplete").join(" ").toLowerCase();
    if (type === "password" || /\bcc-|one-time-code|current-password|new-password/.test(autocomplete)) flag("sensitive_input", "a password or card field");
  }
  for (const attr of ["href", "src", "action", "formaction", "xlink:href", "srcset", "poster"]) {
    for (const value of [...html.matchAll(ATTR(attr.replace(":", "\\:")))].map((m) => m[1] ?? m[2] ?? m[3] ?? "")) {
      if (attr === "srcset") {
        if (value.split(",").some((part) => linkProblem(part.trim().split(/\s+/)[0] ?? ""))) flag("link_scheme", `${attr}="${value.slice(0, 80)}"`);
      } else if (linkProblem(value) && !(attr === "src" && /^data:image\//i.test(value))) flag("link_scheme", `${attr}="${value.slice(0, 80)}"`);
      // A payment page is reached only through the platform's pay button (`/_fm/pay/<key>`), whose address the founder
      // entered: an agent's page never carries one, so a prompt-injected page cannot swap where the money goes.
      if (PAYMENT_HOSTS.test(value.trim())) flag("payment_link", `${attr}="${value.slice(0, 80)}"`);
    }
  }
  // Markup that turns the rest of the page, and the footer the platform appends, into a comment, raw text or an inert
  // template: an unclosed comment (read in order), a raw-text element without its own closing tag, any <template>,
  // anything after </html>.
  let at = 0;
  for (;;) {
    const open = html.indexOf("<!--", at);
    if (open < 0) break;
    const close = html.indexOf("-->", open + 4);
    if (close < 0) {
      flag("swallows_footer", "an unclosed comment");
      break;
    }
    at = close + 3;
  }
  for (const tag of ["textarea", "title", "style", "xmp", "noembed", "noframes", "noscript"]) {
    const opens = (html.match(new RegExp(String.raw`<\s*${tag}\b`, "gi")) ?? []).length;
    const closes = (html.match(new RegExp(String.raw`<\s*/\s*${tag}\s*>`, "gi")) ?? []).length;
    if (opens > closes) flag("swallows_footer", `an unclosed <${tag}>`);
  }
  if (/<\s*(?:plaintext|template)\b/i.test(html)) flag("swallows_footer", "a <plaintext> or <template> element");
  if (/<\/\s*html\s*>\s*\S/i.test(html)) flag("swallows_footer", "content after </html>");
  if (/data-fm-footer/i.test(html)) flag("swallows_footer", "it targets the platform's footer");
  if (!isSvg) {
    // An email address is allowed (mailto: links are); other personal details and code shown as text are not.
    const text = visibleText(html).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ");
    for (const f of communityScreenLocalFlags(text)) {
      if (f === "markup") flag("markup_text", "code shown as text");
      if (f === "personal_data") flag("personal_data", "a phone number or an id number");
    }
  }
  return flags;
}

function screenCss(path: string, css: string): SiteFlag[] {
  const flags: SiteFlag[] = [];
  if (/@import\b/i.test(css)) flags.push({ rule: "css_import", path, detail: "@import" });
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
    const url = (m[2] ?? "").trim();
    if (/^data:(?:image|font)\//i.test(url) || url.startsWith("#")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) flags.push({ rule: "css_outside_url", path, detail: `url(${url.slice(0, 80)})` });
  }
  if (/data-fm-footer|\\[0-9a-f]{1,6}/i.test(css)) flags.push({ rule: "swallows_footer", path, detail: "it targets the platform's footer or uses CSS escapes" });
  // A transform, filter, clip or mask on html or body would carry the fixed footer with it out of the window.
  for (const m of css.matchAll(/(^|[},])\s*(?:html|body|:root)\b[^{]*\{([^}]*)\}/gi)) {
    if (/\b(?:transform|filter|clip-path|clip|mask|perspective|contain|zoom|backdrop-filter)\s*:/i.test(m[2] ?? "")) flags.push({ rule: "swallows_footer", path, detail: "html or body is transformed, clipped or filtered" });
  }
  return flags;
}

/** Screens a whole release. Pure: the orchestrator calls it before saving a release, tests call it directly. */
export function screenSiteFiles(files: readonly SiteScreenFile[]): { flags: SiteFlag[] } {
  const flags: SiteFlag[] = [];
  if (files.length > SITE_LIMITS.maxFiles) flags.push({ rule: "too_many_files", path: "", detail: `${files.length} files` });
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > SITE_LIMITS.maxTotalBytes) flags.push({ rule: "too_large", path: "", detail: `${total} bytes` });
  if (!files.some((f) => f.path === "index.html")) flags.push({ rule: "no_index", path: "", detail: "index.html is missing" });
  for (const file of files) {
    const { path } = file;
    if (file.size > SITE_LIMITS.maxFileBytes) flags.push({ rule: "file_too_large", path, detail: `${file.size} bytes` });
    const segments = path.split("/");
    // eslint-disable-next-line no-control-regex
    if (path.startsWith("/") || segments.some((s) => s === "" || s.startsWith(".")) || path.startsWith("_fm/") || /[\\\u0000-\u001f]/.test(path)) {
      flags.push({ rule: "path", path, detail: "a hidden, platform or malformed path" });
      continue;
    }
    const ext = extOf(path);
    if (!(ext in SITE_FILE_TYPES)) {
      flags.push({ rule: "file_type", path, detail: ext || "no extension" });
      continue;
    }
    if (file.text === undefined) {
      // A page, drawing or stylesheet the screen could not read is never passed unscreened.
      if (ext === ".html" || ext === ".svg" || ext === ".css") flags.push({ rule: "unreadable", path, detail: "the text could not be read as UTF-8" });
      continue;
    }
    if (ext === ".html" || ext === ".svg") flags.push(...screenMarkup(path, file.text, ext === ".svg"));
    else if (ext === ".css") flags.push(...screenCss(path, file.text));
  }
  return { flags };
}

/** "Held back: <words>. The next round of work fixes it." for the Site tab's release list. */
export function siteHeldSentence(flags: readonly SiteFlag[]): string {
  const words = [...new Set(flags.map((f) => SITE_RULE_WORDS[f.rule]))];
  return `Held back: ${words.slice(0, 3).join("; ")}${words.length > 3 ? `; and ${words.length - 3} more` : ""}. The next round of work fixes it.`;
}
