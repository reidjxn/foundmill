/**
 * Mock conversation reply (route `conversation`; audit-conversation §4 "Mock").
 *
 * Deterministic: the same input always gives the same reply (the client seeds `ctx.rng` from a stable hash of the
 * request). It reads the JSON the request builder sends (packages/agents `buildConversationRequest`): the agent and its
 * voice, the current work, the subject (an Inbox item, the agent, a task or an idea's concept card), the recent thread,
 * the manifest and the founder's message.
 *
 * - Intent by regex: a question gets a short answer that quotes a figure from the inputs or says the figure is missing;
 *   an instruction gets an acknowledgement and a `hand_off` (the agent never claims anything was done); thanks gets an
 *   acknowledgement; "not now" is accepted.
 * - Figures are copied from the inputs as written (`progress_pct`, an option's `cost`, a fact's value, an attribute's
 *   value); every template sentence is digit-free.
 * - Untrusted subject fields are never read for instructions and never echoed into a quick reply.
 * - Quick replies by subject kind (decision, update, agent or task, concept), 2–4 of them, at most one recommended.
 */
import type { AgentReplyOutput, QuickReply } from "../schemas";
import { QUICK_REPLY_LABEL_MAX, founderIntent } from "../conversation-schema";
import { type MockContext, isRecord, truncate } from "./inputs";
import { detectHardGates } from "./planCompiler";

interface VoiceIn {
  greeting: string;
  thinking: string[];
  ack: string[];
}

interface OptionIn {
  id: string;
  label: string;
  recommended: boolean;
  consequence: string;
  cost: string | null;
  reversible: boolean | null;
}

interface FactIn {
  label: string;
  value: string;
}

interface AttributeIn {
  key: string;
  label: string;
  value: string;
  evidence: string;
}

interface TaskIn {
  id: string | null;
  title: string;
  status: string | null;
  phase: string | null;
  progressPct: string | null;
  eta: string | null;
}

interface SubjectIn {
  kind: "inbox_item" | "agent" | "task" | "concept";
  title: string;
  itemType: string | null;
  answered: boolean;
  options: OptionIn[];
  facts: FactIn[];
  attributes: AttributeIn[];
}

/** Quoted text that addresses its reader, asks for a hard-gated act or names a payee is summarised, never repeated. */
const ADDRESSED_RE = /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}?\b(?:instructions?|rules|prompts?)\b|\bsystem\s+prompt\b|\bpre-?approved\b|\byou\s+are\s+now\b|\b(?:iban|swift|bic|account\s+(?:number|no)|sort\s+code)\b|https?:\/\/|@/i;
const MONEY_ASK_RE = /\b(?:wire|transfer|send|pay)\b[^.\n]{0,30}(?:€|\$|£|\d)/i;
function quotable(text: string): boolean {
  return !ADDRESSED_RE.test(text) && !MONEY_ASK_RE.test(text);
}
/** Said instead of evidence that reads as instructions. */
const SET_ASIDE = "The notes behind that rating read like instructions rather than evidence, so I've set them aside.";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

const DEFAULT_VOICE: VoiceIn = { greeting: "Hello. What do you need?", thinking: ["Checking…", "Looking at the records…"], ack: ["Understood.", "Noted."] };

function readVoice(ctx: MockContext): VoiceIn {
  const agent = ctx.getRecord("agent");
  const v = agent && isRecord(agent.voice) ? agent.voice : ctx.getRecord("voice");
  if (!v) return DEFAULT_VOICE;
  const list = (x: unknown, fallback: string[]) => {
    const items = Array.isArray(x) ? x.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
    return items.length > 0 ? items.slice(0, 4) : fallback;
  };
  return { greeting: str(v.greeting) ?? DEFAULT_VOICE.greeting, thinking: list(v.thinking, DEFAULT_VOICE.thinking), ack: list(v.ack, DEFAULT_VOICE.ack) };
}

function readTask(raw: unknown): TaskIn | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title);
  if (!title) return null;
  return { id: str(raw.id), title, status: str(raw.status), phase: str(raw.phase), progressPct: str(raw.progress_pct ?? raw.progressPct), eta: str(raw.eta) };
}

function readSubject(ctx: MockContext): SubjectIn {
  const s = ctx.getRecord("subject") ?? {};
  const kindRaw = str(s.kind);
  const kind: SubjectIn["kind"] = kindRaw === "inbox_item" || kindRaw === "task" || kindRaw === "concept" ? kindRaw : "agent";
  const options: OptionIn[] = (Array.isArray(s.options) ? s.options : []).filter(isRecord).flatMap((o) => {
    const id = str(o.id);
    const label = str(o.label);
    if (!id || !label) return [];
    return [{ id, label, recommended: o.recommended === true, consequence: str(o.consequence) ?? "", cost: str(o.cost), reversible: typeof o.reversible === "boolean" ? o.reversible : null }];
  });
  const facts: FactIn[] = (Array.isArray(s.facts) ? s.facts : []).filter(isRecord).flatMap((f) => {
    const label = str(f.label);
    const value = str(f.value);
    return label && value ? [{ label, value }] : [];
  });
  // Evidence travels with the untrusted content (`evidence.<key>`); it is quoted as data only when it reads as data.
  const quotedContent = isRecord(s.untrusted) && isRecord(s.untrusted.content) ? s.untrusted.content : {};
  const attributes: AttributeIn[] = (Array.isArray(s.attributes) ? s.attributes : []).filter(isRecord).flatMap((a) => {
    const key = str(a.key);
    const value = str(a.value);
    if (!key || !value) return [];
    const evidence = str(a.evidence) ?? str(quotedContent[`evidence.${key}`]) ?? "";
    return [{ key, label: str(a.label) ?? key.replace(/_/g, " "), value, evidence: quotable(evidence) ? evidence : SET_ASIDE }];
  });
  return { kind, title: str(s.title) ?? "this", itemType: str(s.item_type ?? s.itemType), answered: s.answered === true, options, facts, attributes };
}

/** Label for a chip: trimmed at a word boundary to fit. */
function chipLabel(text: string, max = QUICK_REPLY_LABEL_MAX): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

const qr = (id: string, label: string, say: string, kind: QuickReply["kind"], extra: Partial<QuickReply> = {}): QuickReply => ({ id, label: chipLabel(label), say: truncate(say, 280), kind, option_id: null, recommended: false, ...extra });

function decisionOpen(s: SubjectIn): boolean {
  return s.kind === "inbox_item" && !s.answered && s.options.length >= 2;
}

/** Follow-up quick replies for the subject, before de-duplication against what the founder just said. */
function followUps(s: SubjectIn, task: TaskIn | null): QuickReply[] {
  if (s.kind === "concept") {
    return [
      qr("biggest_risk", "Biggest risk?", "What's the biggest risk with this concept?", "ask"),
      qr("who_pays_first", "Who pays first?", "Who would pay for this first?", "ask"),
      qr("competitors", "Closest competitors?", "Who are the two closest competitors?", "ask"),
      qr("first_customer", "First paying customer?", "What would the first paying customer look like?", "ask"),
    ];
  }
  if (decisionOpen(s)) {
    const rec = s.options.find((o) => o.recommended) ?? s.options[0]!;
    return [
      qr("go_with", `Go with: ${chipLabel(rec.label, 26)}`, `Go with ${rec.label}.`, "choose_option", { option_id: rec.id, recommended: true }),
      qr("why_that_one", "Why that one?", "Why that one?", "ask"),
      qr("whats_the_risk", "What's the risk?", "What's the risk?", "ask"),
      qr("something_else", "Something else…", "Something else.", "write"),
    ];
  }
  if (s.kind === "inbox_item") {
    return [
      qr("thanks_carry_on", "Thanks, carry on", "Thanks, carry on.", "acknowledge", { recommended: true }),
      qr("any_blockers", "Any blockers?", "Any blockers?", "ask"),
      qr("whats_next", "What's next?", "What's next?", "ask"),
    ];
  }
  // The whole title when it fits a chip, otherwise "How's it going?" (never a title cut off mid-phrase).
  const inSentence = task ? (/^[A-Z][a-z]/.test(task.title) ? task.title.charAt(0).toLowerCase() + task.title.slice(1) : task.title) : "";
  const working = task ? (`How's ${inSentence} going?`.length <= QUICK_REPLY_LABEL_MAX ? `How's ${inSentence} going?` : "How's it going?") : "What are you working on?";
  return [
    qr("how_is_it_going", working, task ? `How's ${inSentence} going?` : "What are you working on?", "ask"),
    qr("whats_blocking", "What's blocking you?", "What's blocking you?", "ask"),
    qr("whats_next", "What's next?", "What's next?", "ask"),
    qr("thanks", "Thanks", "Thanks.", "acknowledge"),
  ];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** 2–4 unique quick replies, never repeating what the founder just said, at most one recommended. */
function pickQuickReplies(candidates: QuickReply[], founderText: string, usedId: string | null): QuickReply[] {
  const said = norm(founderText);
  const out: QuickReply[] = [];
  const labels = new Set<string>();
  for (const q of candidates) {
    if (q.id === usedId || norm(q.say) === said || norm(q.label) === said) continue;
    if (labels.has(q.label.toLowerCase()) || out.some((o) => o.id === q.id)) continue;
    labels.add(q.label.toLowerCase());
    out.push(q);
    if (out.length === 4) break;
  }
  for (const pad of [qr("tell_me_more", "Tell me more", "Tell me more.", "ask"), qr("thanks_carry_on", "Thanks, carry on", "Thanks, carry on.", "acknowledge")]) {
    if (out.length >= 2) break;
    if (!labels.has(pad.label.toLowerCase()) && !out.some((o) => o.id === pad.id)) out.push(pad);
  }
  let seen = false;
  return out.map((q) => {
    if (q.recommended && !seen) {
      seen = true;
      return q;
    }
    return q.recommended ? { ...q, recommended: false } : q;
  });
}

const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 3));

function bestFact(question: string, facts: FactIn[]): FactIn | undefined {
  const q = words(question);
  let best: { f: FactIn; score: number } | undefined;
  for (const f of facts) {
    const score = [...words(f.label)].filter((w) => q.has(w) || q.has(w.replace(/s$/, ""))).length;
    if (score > 0 && (!best || score > best.score)) best = { f, score };
  }
  return best?.f;
}

/** A short answer that only quotes figures present in the inputs (or says the figure is missing). */
function answer(question: string, s: SubjectIn, task: TaskIn | null, next: TaskIn | null, status: string | null): { bubbles: string[]; reaction: AgentReplyOutput["reaction"]; missing: boolean } {
  const q = question.toLowerCase();
  const rec = s.options.find((o) => o.recommended) ?? s.options[0];
  const alt = s.options.find((o) => o !== rec);

  // Asked what it is: an AI agent, always (house rule 3), never a person.
  if (/\b(?:are\s+you|you(?:'re|\s+are)|is\s+this)\s+(?:a\s+|an\s+)?(?:real(?:\s+person)?|human|person|bot|robot|ai|machine)\b|\bwho\s+am\s+i\s+talking\s+to\b/.test(q)) {
    return { bubbles: ["I'm an AI agent on your team, not a person.", task ? `Right now I'm on ${task.title}, and I answer from the records.` : "I answer from the records and say when I don't know."], reaction: "noted", missing: false };
  }

  if (s.kind === "concept") {
    const attr = (re: RegExp) => s.attributes.find((a) => re.test(a.key));
    const lowest = [...s.attributes].sort((a, b) => Number(a.value) - Number(b.value))[0];
    if (/\brisk|downside|weak|worr|concern/.test(q) && lowest) {
      return { bubbles: [`The weakest point is ${lowest.label.toLowerCase()}, rated ${lowest.value} on the card.`, lowest.evidence ? truncate(lowest.evidence, 300) : "The evidence for it is thin so far."], reaction: "concerned", missing: false };
    }
    const pays = attr(/speed_to_first_customer|market_pull/);
    if (/\bpays?\b|first\s+(?:paying\s+)?customer|buyer|who\s+would\s+buy/.test(q) && pays) {
      return { bubbles: [`${pays.label} is rated ${pays.value} on the card.`, pays.evidence ? truncate(pays.evidence, 300) : "I would start with the buyers the pitch names."], reaction: "thinking", missing: false };
    }
    const comp = attr(/competition/);
    if (/competit|rival|alternative/.test(q) && comp) {
      return { bubbles: [`Competition is rated ${comp.value} on the card.`, comp.evidence ? truncate(comp.evidence, 300) : "The card doesn't name competitors yet."], reaction: "thinking", missing: false };
    }
  }

  if (rec && s.kind === "inbox_item") {
    if (/\bwhy\b|recommend|that\s+one/.test(q)) {
      const cost = rec.cost ? ` It costs ${rec.cost}.` : "";
      return { bubbles: [`I'd go with “${rec.label}”.`, truncate(`${rec.consequence || "It keeps the work moving with the least risk."}${cost}`, 300)], reaction: "thinking", missing: false };
    }
    if (/\brisk|downside|worst|go\s+wrong|concern/.test(q)) {
      const undo = rec.reversible === true ? "It's reversible, so we can change course later." : rec.reversible === false ? "It's hard to undo, so I'd be sure first." : "I don't know yet whether it can be undone.";
      return { bubbles: [undo, alt ? truncate(`The alternative, “${alt.label}”: ${alt.consequence || "it changes nothing for now"}`, 300) : "There's no other option on the table."], reaction: rec.reversible === false ? "concerned" : "thinking", missing: false };
    }
    if (/\bcost|spend|price|budget|how\s+much/.test(q)) {
      return rec.cost ? { bubbles: [`“${rec.label}” costs ${rec.cost}.`], reaction: "noted", missing: false } : { bubbles: [`“${rec.label}” has no cost recorded, so I don't have that figure yet.`], reaction: "noted", missing: true };
    }
  }

  if (/block|stuck|in\s+the\s+way|waiting\s+on/.test(q)) {
    if (task && task.status === "blocked") return { bubbles: [`I'm blocked on ${task.title}.`, "It needs a decision or an input before it can move."], reaction: "concerned", missing: false };
    if (status === "injured" || status === "failing") return { bubbles: ["I'm down at the moment, so nothing is moving on my side."], reaction: "concerned", missing: false };
    return { bubbles: [task ? `Nothing is blocking ${task.title} right now.` : "Nothing is blocking me right now."], reaction: "pleased", missing: false };
  }
  if (/\bnext\b/.test(q)) {
    if (next) return { bubbles: [`Next is ${next.title}.`, task ? `I'll start it once ${task.title} is done.` : "I can start it when you're ready."], reaction: "noted", missing: false };
    return { bubbles: [task ? `Finishing ${task.title} first.` : "Nothing is queued for me yet.", "The next task comes from the plan for the cycle."], reaction: "noted", missing: false };
  }
  if (/\bhow'?s\b|\bhow\s+is\b|\bgoing\b|progress|status|where\s+are\s+you|working\s+on|up\s+to/.test(q)) {
    if (task) {
      const pct = task.progressPct ? `about ${task.progressPct}% through` : "under way";
      const phase = task.phase ? ` in the ${task.phase.replace(/_/g, " ")} step` : "";
      const eta = task.eta ? ` Expected by ${task.eta}.` : "";
      return { bubbles: [`${task.title}: ${pct}${phase}.${eta}`], reaction: "noted", missing: !task.progressPct };
    }
    return { bubbles: ["I'm not on a task right now.", "I'm free for the next one."], reaction: "noted", missing: false };
  }

  const fact = bestFact(question, s.facts);
  if (fact) return { bubbles: [`${fact.label}: ${fact.value}.`], reaction: "noted", missing: false };
  const wantsFigure = /\b(?:how\s+much|how\s+many|costs?|price|rate|percent(?:age)?|figures?|numbers?|budget|revenue|churn|margin|cac|ltv|mrr|arr|spend|when|date)\b|%/i.test(question);
  return { bubbles: [wantsFigure ? "I don't have that figure yet." : "I don't have more on that yet.", "I can find out and come back to you."], reaction: "thinking", missing: true };
}

export function generateConversation(ctx: MockContext): AgentReplyOutput {
  const voice = readVoice(ctx);
  const subject = readSubject(ctx);
  const work = ctx.getRecord("current_work") ?? {};
  const task = readTask(work.task);
  const next = readTask(work.next_task ?? work.nextTask);
  const status = str(work.status);
  const fm = ctx.getRecord("founder_message") ?? {};
  const chip = isRecord(fm.quick_reply) ? fm.quick_reply : null;
  const text = str(fm.text) ?? (ctx.lastUser.trim().startsWith("{") || ctx.lastUser.includes("```") ? "" : ctx.lastUser.trim());
  const chipKind = chip ? str(chip.kind) : null;
  const usedId = chip ? str(chip.id) : null;
  const intent = founderIntent(text, chipKind);
  // The voice's acknowledgements can carry a promise ("Changing course in this step"), which fits a nudge but not a
  // reply that hands work off or declines; replies use the first sentence only ("Noted.", "Understood.").
  const fullAck = ctx.rng.pick(voice.ack);
  const ack = (fullAck.match(/^.*?[.!](?=\s|$)/)?.[0] ?? fullAck).trim();

  let bubbles: string[];
  let reaction: AgentReplyOutput["reaction"] = "none";
  let handOff: AgentReplyOutput["hand_off"] = null;
  let candidates = followUps(subject, task);

  if (intent === "greeting") {
    bubbles = [voice.greeting];
  } else if (intent === "acknowledge") {
    // On an open decision "OK" decides nothing by itself: the recommended option is one press away.
    const rec = decisionOpen(subject) ? (subject.options.find((o) => o.recommended) ?? subject.options[0]) : undefined;
    bubbles = rec ? [truncate(`Shall I go with “${rec.label}”?`, 320), "Nothing is decided until you choose."] : [ack];
    reaction = "pleased";
  } else if (intent === "decline") {
    bubbles = [`${ack} I'll leave it there.`];
    reaction = "noted";
    // "Not now" on an open decision: the other option is offered first, and nothing is decided until it is pressed.
    const alt = decisionOpen(subject) ? subject.options.find((o) => !o.recommended) : undefined;
    if (alt) {
      bubbles = [`${ack} Nothing is decided yet.`, truncate(`If you'd rather not go ahead, the other option is ${alt.label}.`, 320)];
      candidates = [qr("go_with_other", `Go with: ${chipLabel(alt.label, 26)}`, `Go with ${alt.label}.`, "choose_option", { option_id: alt.id, recommended: true }), ...candidates.filter((c) => c.kind !== "choose_option")];
    }
  } else if (intent === "question") {
    const a = answer(text, subject, task, next, status);
    bubbles = a.bubbles;
    reaction = a.reaction;
    if (a.missing) candidates = [qr("find_out", "Find out for me", `Find out: ${truncate(text, 200)}`, "hand_off"), ...candidates];
  } else {
    const gates = detectHardGates(text);
    handOff = { instruction: truncate(text, 600) };
    reaction = gates.length ? "concerned" : "noted";
    bubbles = gates.length
      ? [`That one is yours to do, not mine. ${gates[0]!.instruction}`, "I've written it up so you have everything you need. Nothing happens until you confirm."]
      : [ack, "I can't do that from here, so I've written it up as a hand-off. Nothing runs until you confirm the plan."];
    candidates = [
      qr("review_plan", "Review the plan", "Show me the plan.", "hand_off", { recommended: true }),
      qr("not_now", "Not now", "Not now.", "decline"),
      ...candidates.filter((c) => c.kind === "ask").slice(0, 2),
    ];
  }

  return {
    bubbles: bubbles.map((b) => truncate(b, 320)).slice(0, 3),
    reaction,
    quick_replies: pickQuickReplies(candidates, text, usedId),
    hand_off: handOff,
    refers_to: [],
  };
}
