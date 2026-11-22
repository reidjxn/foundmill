/**
 * The two functions the hosted browser runs inside a page (the sandbox's Chrome, through Playwright's `page.evaluate`):
 * `readPage` reads the page's text, its controls and its forms and stamps each control with this read's stamp, and
 * `stampedLabel` reads back the one element a stamp names, so a step presses only what was classified. They reach the
 * sandbox as source text (`PAGE_FUNCTIONS`), so they use nothing but the page's own DOM.
 */
import type { PageElement, PageForm } from "./classify";
import type { RawSnapshot } from "./sessions";

/* v8 ignore start -- runs inside the hosted page, not in Node */
export function readPage({ max, stamp }: { max: number; stamp: string }): Omit<RawSnapshot, "url"> {
  const SECRET = /pass|pwd|card|cvv|cvc|otp|code|pin|secret|token|ssn|iban|routing|account.?num|sort.?code|tax.?id/i;
  // Stamps of an earlier read are removed first, so a ref can only ever find the element it was given for.
  for (const old of Array.from(document.querySelectorAll("[data-fm-ref]"))) old.removeAttribute("data-fm-ref");
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const text = (v: string | null | undefined, n: number) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const labelOf = (el: Element): string => {
    const input = el as HTMLInputElement;
    const byLabel = input.labels && input.labels.length > 0 ? input.labels[0]!.innerText : "";
    const submit = input.tagName === "INPUT" && /^(submit|button|reset)$/.test(input.type) ? input.value : "";
    return text(el.getAttribute("aria-label") || byLabel || submit || (el as HTMLElement).innerText || input.placeholder || el.getAttribute("title") || el.getAttribute("alt") || input.name, 120);
  };
  const fieldOf = (el: Element) => {
    const input = el as HTMLInputElement;
    return { type: (input.type || el.tagName).toLowerCase(), name: text(input.name || input.id, 80), autocomplete: text(el.getAttribute("autocomplete"), 40), label: labelOf(el) };
  };
  const forms = Array.from(document.forms);
  const controls = Array.from(document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=switch], [contenteditable=true]")).filter(visible).slice(0, max);
  const elements = controls.map((el, i) => {
    el.setAttribute("data-fm-ref", `${stamp}-${i}`);
    const input = el as HTMLInputElement;
    const tag = el.tagName;
    const type = (input.type || "").toLowerCase();
    const aria = el.getAttribute("role");
    const role = tag === "A" || aria === "link" ? "link" : tag === "SELECT" ? "select" : type === "checkbox" || aria === "checkbox" || aria === "switch" ? "checkbox" : type === "radio" ? "radio" : type === "file" ? "file" : tag === "BUTTON" || aria === "button" || /^(submit|button|reset|image)$/.test(type) ? "button" : tag === "INPUT" || tag === "TEXTAREA" || el.getAttribute("contenteditable") === "true" ? "textbox" : "other";
    const form = input.form ? forms.indexOf(input.form) : -1;
    const around = el.closest("form, section, article, dialog, [role=dialog], main") ?? el.parentElement;
    return { ...fieldOf(el), role, near: text((around as HTMLElement | null)?.innerText, 400), ...(tag === "A" ? { href: (el as HTMLAnchorElement).href } : {}), ...(form >= 0 ? { form } : {}) };
  });
  const values = controls
    .filter((el) => /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
    .map((el) => {
      const input = el as HTMLInputElement;
      const f = fieldOf(el);
      if (f.type === "password" || f.type === "file" || SECRET.test(`${f.name} ${f.autocomplete} ${f.label}`)) return "";
      const value = f.type === "checkbox" || f.type === "radio" ? (input.checked ? "on" : "off") : el.tagName === "SELECT" ? ((el as unknown as HTMLSelectElement).selectedOptions[0]?.text ?? "") : input.value;
      return f.label && value ? `${f.label}: ${text(value, 200)}` : "";
    })
    .filter(Boolean);
  const body = document.body?.innerText ?? "";
  const captcha = Boolean(document.querySelector("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], iframe[src*='challenges.cloudflare'], iframe[src*='turnstile'], .g-recaptcha, .h-captcha, [data-sitekey]")) || /verify (that )?you('| a)re (a )?human|are you a robot|unusual traffic/i.test(body.slice(0, 4000));
  const password = controls.some((el) => (el as HTMLInputElement).type === "password" && el.getAttribute("autocomplete") !== "new-password");
  // A page that asks for a code it sent (two-step sign-in) is the founder's too, with or without a password field.
  const codePage = controls.length <= 12 && /(enter|type) (the|your) (\d-digit )?(verification |security |login |sign-in )?code|we (just )?(sent|emailed|texted) (you )?a (\d-digit )?(verification |security |login )?code|two[- ]step verification|authenticator app/i.test(body.slice(0, 4000));
  const signIn = codePage || (password && (controls.length <= 12 || /\/(login|log-in|signin|sign-in|sign_in|auth|sso)(\/|\?|$)/i.test(location.pathname)));
  return {
    title: text(document.title, 200),
    text: [body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(), ...values].join("\n"),
    elements: elements as PageElement[],
    forms: forms.map((f) => ({ ...(f.getAttribute("action") ? { action: f.action } : {}), fields: Array.from(f.elements).slice(0, 40).map(fieldOf) })) as PageForm[],
    needsFounder: captcha ? "captcha" : signIn ? "sign_in" : null,
  };
}
/* v8 ignore stop */

/** Runs in the page: the role-independent words of the one element a stamp names, or null when it names none or several. */
/* v8 ignore start -- runs inside the hosted page, not in Node */
export function stampedLabel(selector: string): string | null {
  const found = document.querySelectorAll(selector);
  if (found.length !== 1) return null;
  const el = found[0] as HTMLInputElement;
  const byLabel = el.labels && el.labels.length > 0 ? el.labels[0]!.innerText : "";
  const submit = el.tagName === "INPUT" && /^(submit|button|reset)$/.test(el.type) ? el.value : "";
  return (el.getAttribute("aria-label") || byLabel || submit || el.innerText || el.placeholder || el.getAttribute("title") || el.getAttribute("alt") || el.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
}
/* v8 ignore stop */

/** The source of both functions, for the script that runs in the sandbox. */
// `__name`: a bundler that keeps function names (tsx, esbuild `keepNames`) wraps them in calls to it.
export const PAGE_FUNCTIONS = `const __name = (f) => f;\nconst readPage = ${readPage.toString()};\nconst stampedLabel = ${stampedLabel.toString()};`;
