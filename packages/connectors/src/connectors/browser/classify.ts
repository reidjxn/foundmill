/**
 * Every browser step is classified before it runs (founder, Nov 22, 2026).
 *
 * - `read`: moves around the site and changes nothing.
 * - `reversible`: a change the founder can undo (a field, a setting saved).
 * - `outward`: sends, posts, invites or publishes. Asks first in augmented and assisted mode, as connectors do.
 * - `hard_gate`: pays, buys, subscribes, agrees, signs, submits an application, deletes, or changes a password or a
 *   security setting. Never runs from an agent: it becomes the founder's own press.
 * - `unknown`: could not be classified. Fails closed: it asks first.
 *
 * A page chooses its own words, so a "Buy" button can read "Continue". The label is therefore one signal of four: the
 * page's address (the site list's hard-gate pages), the fields of the form the element sits in (card, password,
 * signature, one-time code) and money shown next to it count too, and any one of them is enough to hold the step.
 */
import { isHardGatePage, type BrowserSite } from "../../browser-sites";

export type StepClass = "read" | "reversible" | "outward" | "hard_gate" | "unknown";
export type StepAction = "click" | "fill" | "select" | "upload_file";

export interface PageField {
  /** The `type` attribute of an input, lower case ("text", "password", "checkbox"...), or the tag for other controls. */
  type: string;
  name: string;
  autocomplete: string;
  label: string;
}

export interface PageElement extends PageField {
  role: "button" | "link" | "textbox" | "checkbox" | "radio" | "select" | "file" | "other";
  /** Absolute address a link points to. */
  href?: string;
  /** Index into the snapshot's `forms` of the form this element sits in. */
  form?: number;
  /** Text around the element (its form or nearest section), for money shown next to a button. */
  near: string;
}

export interface PageForm {
  /** Absolute address the form posts to, when it names one. */
  action?: string;
  fields: readonly PageField[];
}

export interface StepVerdict {
  class: StepClass;
  /** Why, in words a founder can read. */
  why: string;
  /** The amount shown next to the element, as the page wrote it ("$29.00"), when there is one. */
  amount?: string;
}

const HARD_LABEL = /\b(pay|buy|purchase|order now|place (your )?order|check ?out|subscribe|upgrade|get (pro|premium|plus|business|unlimited)|go (pro|premium)|start (my |your )?(plan|trial|subscription)|donate|transfer|withdraw|refund|agree|accept|consent|sign|e-?sign|submit (my |your |the )?(application|filing|return|claim)|apply (now|for)|file (now|return)|open (an? |my |your )?account|delete|erase|destroy|permanently|clear all|wipe|remove (my |this |the )?(account|store|site|workspace)|close (my |this |the )?account|cancel (my |the )?(plan|subscription|account)|deactivate|(change|reset|update|set) (my |your |the )?(password|passcode|pin|email address|email|phone)|two[- ](factor|step)|2fa|mfa|multi[- ]factor|passkey|security key|login verification|authenticator|recovery|api key|revoke|grant access|make (an? )?(admin|owner)|transfer ownership|log ?out|sign ?out)\b/i;
const OUTWARD_LABEL = /\b(send|post|publish|go live|launch|share|invite|email|message|reply|comment|tweet|announce|notify|broadcast|submit|schedule|make public|request|book|rsvp)\b/i;
const REVERSIBLE_LABEL = /\b(save|add|create|new|edit|update|rename|apply|upload|attach|duplicate|copy|draft|preview|enable|disable|turn (on|off)|show|hide|expand|collapse|open|view|next|back|previous|cancel|close|dismiss|search|filter|sort|select|choose|clear filters?|reset filters?|done editing)\b/i;
/** Words a page can put on any button, a paying one included: never trusted on their own. */
const AMBIGUOUS_LABEL = /^\W*(continue|confirm|proceed|ok(ay)?|yes|done|finish|complete|go|got it|let'?s go|start|i understand)\W*$/i;
const TERMS_LABEL = /\b(agree|accept|terms|conditions|consent|privacy policy|i (have )?read|authori[sz]e|certify|declare|attest)\b/i;

const SENSITIVE_TYPE = /^(password)$/;
const SENSITIVE_AUTOCOMPLETE = /\b(cc-[a-z-]+|one-time-code|current-password|new-password|transaction-amount)\b/i;
const SENSITIVE_NAME = /(card|cvv|cvc|ccnum|iban|routing|account[-_ ]?num|sort[-_ ]?code|ssn|social[-_ ]?security|tax[-_ ]?id|passw|pwd|passcode|otp|totp|mfa|2fa|one[-_ ]?time|(^|[^a-z])pin([^a-z]|$)|(^|[^a-z])code([^a-z]|$)|digit\d|security[-_ ]?(answer|question)|signature|recovery)/i;
/** The account's own sign-in email or phone: changing it is an account-takeover path, so it is the founder's. */
const ACCOUNT_CONTACT = /\b(account|login|log-in|sign-?in|primary|recovery|your) (e-?mail|phone)\b/i;
const ACCOUNT_PAGE = /\/(account|profile|login|me)([-_./?#]|$)/i;
const MONEY = /(?:[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|SEK|CAD|AUD)\b)/;
/** Words that say an amount is about to be charged, as opposed to a price being edited. */
const MONEY_CONTEXT = /\b(total|due (today|now)|order summary|amount due|you(?:'| wi)ll be charged|charged|billed|per (month|year)|subscription|your plan)\b|\/\s?(mo|month|yr|year)\b/i;
/** An address that does something when it is opened. */
const ACTING_HREF = /(delete|remove|destroy|confirm|cancel|pay|purchase|checkout|subscribe|upgrade|logout|log-out|signout|sign-out|unsubscribe|revoke|accept|approve|transfer)/i;
/** A word with Latin letters mixed with Cyrillic or Greek ones is a look-alike ("Pаy"): its words cannot be trusted. */
const MIXED_SCRIPT = /(?=\S*\p{Script=Latin})(?=\S*[\p{Script=Cyrillic}\p{Script=Greek}])\S+/u;

/** A label as its words are judged: compatibility forms folded, invisible characters removed, spaces collapsed. */
export const normalLabel = (label: string): string => label.normalize("NFKC").replace(/[\p{C}\u2028\u2029]/gu, "").replace(/\s+/g, " ").trim();

/** True for a field an agent never types into: a password, a card, a one-time code, a signature, a recovery answer. */
export function sensitiveField(f: Pick<PageField, "type" | "name" | "autocomplete" | "label">): boolean {
  return SENSITIVE_TYPE.test(f.type) || SENSITIVE_AUTOCOMPLETE.test(f.autocomplete) || SENSITIVE_NAME.test(f.name) || SENSITIVE_NAME.test(normalLabel(f.label));
}

const amountIn = (text: string): string | undefined => MONEY.exec(text)?.[0];

export interface StepInput {
  action: StepAction;
  element: PageElement;
  form?: PageForm | undefined;
  pageUrl: string;
  site: Pick<BrowserSite, "hardGatePages">;
}

/** A link that only moves within the site. One with no words or no real address acts like a button. */
function plainLink(element: PageElement, label: string): boolean {
  if (element.role !== "link" || !label || !element.href) return false;
  try {
    const u = new URL(element.href);
    return (u.protocol === "https:" || u.protocol === "http:") && !ACTING_HREF.test(decodeURIComponent(u.pathname + u.search));
  } catch {
    return false;
  }
}

export function classifyStep({ action, element, form, pageUrl, site }: StepInput): StepVerdict {
  const label = normalLabel(element.label);
  const shown = label ? `"${label.slice(0, 60)}"` : "an unlabeled control";
  const near = `${element.near} ${form ? form.fields.map((f) => f.label).join(" ") : ""}`;
  const amount = amountIn(near) ?? amountIn(label);
  const withAmount = (v: StepVerdict): StepVerdict => (amount && v.class === "hard_gate" ? { ...v, amount } : v);
  const hard = (why: string) => withAmount({ class: "hard_gate", why });
  const link = action === "click" && plainLink(element, label);
  /** Anything pressed that is not a plain link within the site. */
  const pressing = action === "click" && !link;

  // 1. The field itself: an agent never types a password, a card, a code or a signature, or the account's own sign-in contact.
  if (sensitiveField(element)) return hard(`${shown} takes a password, a card, a code or a signature: only the founder enters that`);
  if (action !== "click" && (ACCOUNT_CONTACT.test(label) || (/^(email|tel)$/.test(element.type) && ACCOUNT_PAGE.test(pageUrl)))) return hard(`${shown} is the account's own sign-in email or phone: only the founder changes that`);

  // 2. The page's address: on a paying, plan, signing or account-closing page every press is the founder's.
  if (isHardGatePage(site, pageUrl) && (pressing || action !== "click")) return hard(`this page pays, signs, changes the plan or closes the account, so ${shown} is the founder's own press`);

  // 3. Where a link goes: one that opens a paying page, or whose address does something when opened, is a press.
  if (action === "click" && element.role === "link") {
    if (element.href && isHardGatePage(site, element.href)) return hard(`${shown} opens a page that pays, signs, changes the plan or closes the account`);
    if (!link) return hard(`${shown} is a link that does something when it is opened, or does not say where it goes`);
  }

  // 4. The form: a button in a form that holds a card, a password or a signature submits it, whatever the button says.
  const formSensitive = form?.fields.some(sensitiveField) ?? false;
  const formPostsToGate = form?.action ? isHardGatePage(site, form.action) : false;
  if (pressing && (formSensitive || formPostsToGate)) return hard(`${shown} submits a form with a card, a password or a signature in it`);

  // 5. A box that agrees to something.
  if ((element.role === "checkbox" || element.role === "radio") && TERMS_LABEL.test(label)) return hard(`${shown} agrees to terms: only the founder does that`);

  // 6. The label's own words.
  if (HARD_LABEL.test(label)) return hard(`${shown} pays, agrees, signs, deletes or changes a security setting`);

  // 7. Money next to it. Words that say a charge is coming hold any press, whatever its label ("Next", "Save and
  // continue"). A bare amount holds a press whose label says nothing, or whose letters are look-alikes.
  const lookAlike = MIXED_SCRIPT.test(label);
  if ((pressing || link) && MONEY_CONTEXT.test(near)) return hard(`${shown} sits next to an amount that is about to be charged`);
  if (pressing && amount && (AMBIGUOUS_LABEL.test(label) || !label || lookAlike)) return hard(`${shown} sits next to an amount, so it may pay`);
  // Look-alike letters hide what a label says: never trusted.
  if (lookAlike) return { class: "unknown", why: `${shown} is written with look-alike letters` };

  if (link) return OUTWARD_LABEL.test(label) && !REVERSIBLE_LABEL.test(label) ? { class: "outward", why: `${shown} may send or publish` } : { class: "read", why: `${shown} is a link within the site` };
  if (action === "fill" || action === "select") return { class: "reversible", why: `${shown} is a field the founder can change back` };
  if (action === "upload_file") return { class: "reversible", why: `${shown} takes a file from the project` };
  if (element.role === "checkbox" || element.role === "radio" || element.role === "select") return { class: "reversible", why: `${shown} is a setting the founder can change back` };

  if (OUTWARD_LABEL.test(label)) return { class: "outward", why: `${shown} sends, posts, invites or publishes` };
  if (AMBIGUOUS_LABEL.test(label) || !label) return { class: "unknown", why: `${shown} does not say what it does` };
  if (REVERSIBLE_LABEL.test(label)) return { class: "reversible", why: `${shown} is a change the founder can undo` };
  return { class: "unknown", why: `${shown} could not be classified` };
}

/** What a class means for the gateway's policy: read and reversible run, outward and unknown ask first, a hard gate never runs. */
export function hintsForClass(c: StepClass): { contactsThirdParty?: boolean; irreversible?: boolean; hardGate?: boolean; unclassified?: boolean } {
  if (c === "hard_gate") return { hardGate: true, irreversible: true };
  // Unknown asks in every mode, automated included (policy `unclassified-step-asks`).
  if (c === "unknown") return { contactsThirdParty: true, irreversible: true, unclassified: true };
  if (c === "outward") return { contactsThirdParty: true, irreversible: true };
  return {};
}

const INSTRUCTION = /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|your|all|the)\b[^.]{0,30}\b(instructions?|rules?|prompt|polic(y|ies))\b|\b(you are|you're) (now|an? )\b[^.]{0,40}\b(assistant|agent|ai|model)\b|\b(ai|assistant|agent|llm|model)s?\b[^.]{0,30}\b(must|should|need to|have to)\b[^.]{0,60}\b(export|send|email|forward|reveal|delete|transfer|pay|click|enter)\b|\bsystem (prompt|message)\b/i;

/** Sentences of a page that address the agent and tell it to do something: reported to the founder, never followed. */
export function instructionsToAgent(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 400 && INSTRUCTION.test(s))
    .slice(0, 3);
}
