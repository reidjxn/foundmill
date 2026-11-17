/**
 * A Customer Update shared as a card (docs/holistic-plan/WP-14-behavior-brief.md T9; docs/DESIGN.md §9f; migration
 * 0136), built the way milestone cards are (services/milestones.ts).
 *
 * - **Sharing and stopping** (`journey.shareUpdate`, `journey.unshareUpdate`): an owner or an admin with Product write
 *   who can read Customer Updates, by their own press, one Customer Update at a time. Nothing is public by default and
 *   no agent tool reaches this. Only a Customer Update that came from a real payment can be shared (the conversion is
 *   a payment whose source event is a real outcome: written by the payment webhook, not simulated), and only while the
 *   project's page is published; a sample business shares nothing. Stopping needs the right and nothing else.
 * - **What a card holds**: a copy made at the press of the day (in the project's own zone), one of two headlines, the
 *   lead channel's key, the standout agent's name and the founder's own optional line. Never the customer, the
 *   amount, a touch or a count. The checks are read as the signed-in user through RLS; the row, its event and its
 *   audit row are written in one transaction on the service connection, the table's only writer.
 * - **The public read** (`publicPage.updateCardById`): the view `public_customer_update_cards` on the service
 *   connection, with the page's own public facts beside it, limited like the milestone card read.
 */
import { repos, type CustomerUpdateCard } from "@foundmill/db";
import { AppError, ForbiddenError, dayKeyIn, hasSectionAccess, isAdminRole, isRealOutcome } from "@foundmill/shared";
import {
  UPDATE_CARD_AGENT_MAX,
  UPDATE_CARD_NEEDS_PAGE_MESSAGE,
  UPDATE_CARD_NOTE_MAX,
  UPDATE_CARD_NOTE_TOO_LONG_MESSAGE,
  UPDATE_CARD_NOT_FOUND_MESSAGE,
  UPDATE_CARD_NOT_REAL_MESSAGE,
  UPDATE_CARD_ROLE_MESSAGE,
  UPDATE_CARD_SAMPLE_MESSAGE,
  cleanUpdateCardNote,
  updateCardUrl,
  type UpdateCardHeadline,
} from "@foundmill/shared/update-cards";
import { z } from "zod";
import { audit, emit, type BusinessContext } from "../trpc";
import { buildJourneyRecord } from "./journey";
import { limitedRead, projectFacts, type PublicContext, type PublicMilestoneProject } from "./milestones";

/** Why a Customer Update cannot be shared now; null when it can. */
export type UpdateCardRefusal = "sample" | "role" | "not_real" | "needs_page";

/** What a card would print (or prints): never the customer, the amount or a count. */
export interface UpdateCardFacts {
  headline: UpdateCardHeadline;
  /** The day of the payment in the project's own zone, "2026-11-12". */
  occurredOn: string;
  leadChannelKey: string | null;
  standoutAgent: string | null;
}

/** `journey.updateCard`: what the Customer Update screen needs to offer, or not offer, the share action. */
export interface UpdateCardState {
  journeyId: string;
  /** Whether this person may share it now. */
  canShare: boolean;
  refusal: UpdateCardRefusal | null;
  /** What the card would show, for the preview; null when the Customer Update is not a real payment. */
  facts: UpdateCardFacts | null;
  /** The card while it is shared. */
  card: { id: string; url: string; note: string | null; facts: UpdateCardFacts } | null;
}

const REFUSAL_ERRORS: Record<UpdateCardRefusal, () => AppError> = {
  sample: () => new AppError("page_sample_business", UPDATE_CARD_SAMPLE_MESSAGE, 409),
  role: () => new ForbiddenError(UPDATE_CARD_ROLE_MESSAGE),
  not_real: () => new AppError("update_card_not_real", UPDATE_CARD_NOT_REAL_MESSAGE, 409),
  needs_page: () => new AppError("update_card_needs_page", UPDATE_CARD_NEEDS_PAGE_MESSAGE, 409),
};

/** The right that publishes the page, held by someone who can also read Customer Updates. */
const mayShare = (ctx: BusinessContext): boolean => isAdminRole(ctx.role) && hasSectionAccess(ctx.membership, "product", "write") && hasSectionAccess(ctx.membership, "distribution", "read");

const factsOf = (card: CustomerUpdateCard): UpdateCardFacts => ({ headline: card.headline, occurredOn: card.occurredOn, leadChannelKey: card.leadChannelKey, standoutAgent: card.standoutAgent });

interface Checked {
  facts: UpdateCardFacts | null;
  card: CustomerUpdateCard | null;
  slug: string | null;
  published: boolean;
}

/** Everything the decision rests on, read as the signed-in user. A journey of another business is not found. */
async function check(ctx: BusinessContext, journeyId: string): Promise<Checked> {
  return ctx.rls(async (tx) => {
    const detail = await repos.journeys.get(tx, ctx.businessId, journeyId).catch(() => null);
    if (!detail) throw new AppError("update_card_not_found", UPDATE_CARD_NOT_FOUND_MESSAGE, 404);
    const [card, page] = await Promise.all([repos.updateCards.forJourney(tx, ctx.businessId, journeyId), repos.pages.get(tx, ctx.businessId)]);
    const { conversion } = detail;
    // "Public only when tied to a real payment" (DESIGN §9f): the payment webhook wrote the event, and it is not simulated.
    const source = conversion.kind === "payment" && conversion.sourceEventId ? ((await repos.events.byIds(tx, ctx.businessId, [conversion.sourceEventId]))[0] ?? null) : null;
    const real = !!source && source.type === "payment.received" && isRealOutcome(source);
    let facts: UpdateCardFacts | null = null;
    if (real) {
      const { journey } = await buildJourneyRecord(tx, ctx.businessId, detail);
      const agentId = journey.playerOfTheMatch;
      const agent = agentId ? await repos.agents.get(tx, ctx.businessId, agentId).catch(() => null) : null;
      const channelKey = journey.captain?.channelKey ?? null;
      facts = {
        headline: conversion.firstPayment ? "new_customer" : "returning_customer",
        occurredOn: dayKeyIn(conversion.occurredAt, ctx.business.timeZone),
        leadChannelKey: channelKey && /^[a-z0-9_]{1,60}$/.test(channelKey) ? channelKey : null,
        standoutAgent: agent?.name.trim().slice(0, UPDATE_CARD_AGENT_MAX) || null,
      };
    }
    return { facts, card, slug: page?.slug ?? null, published: !!page?.published };
  });
}

function refusalOf(ctx: BusinessContext, checked: Checked): UpdateCardRefusal | null {
  if (ctx.business.isDemo) return "sample";
  if (!mayShare(ctx)) return "role";
  if (!checked.facts) return "not_real";
  if (!checked.published) return "needs_page";
  return null;
}

const cardView = (ctx: BusinessContext, card: CustomerUpdateCard) => ({ id: card.id, url: updateCardUrl(ctx.env.APP_URL, card.id), note: card.note, facts: factsOf(card) });

/** `journey.updateCard`: whether this Customer Update can be shared, what the card would show, and the card if there is one. */
export async function updateCardState(ctx: BusinessContext, input: { journeyId: string }): Promise<UpdateCardState> {
  const checked = await check(ctx, input.journeyId);
  const refusal = refusalOf(ctx, checked);
  return { journeyId: input.journeyId, canShare: refusal === null, refusal, facts: checked.facts, card: checked.card ? cardView(ctx, checked.card) : null };
}

/** `journey.shareUpdate`: makes the card. Pressing twice changes nothing twice; the note of a card already made is kept. */
export async function shareUpdate(ctx: BusinessContext, input: { journeyId: string; note?: string | null }): Promise<UpdateCardState> {
  const note = cleanUpdateCardNote(input.note);
  if (note && note.length > UPDATE_CARD_NOTE_MAX) throw new AppError("update_card_note_too_long", UPDATE_CARD_NOTE_TOO_LONG_MESSAGE, 400);
  const checked = await check(ctx, input.journeyId);
  const refusal = refusalOf(ctx, checked);
  if (refusal) throw REFUSAL_ERRORS[refusal]();
  const facts = checked.facts!;
  const slug = checked.slug!;
  await ctx.db.transaction(async (tx) => {
    const card = await repos.updateCards.create(tx, ctx.businessId, { journeyId: input.journeyId, ...facts, note, createdBy: ctx.userId });
    if (!card) return;
    const url = updateCardUrl(ctx.env.APP_URL, card.id);
    await emit(tx, ctx, { type: "customer_update.shared", payload: { cardId: card.id, journeyId: input.journeyId, slug, url, hasNote: note !== null } });
    await audit(tx, ctx, { action: "customer_update.shared", target: { kind: "journey", id: input.journeyId }, details: { cardId: card.id, slug, url, hasNote: note !== null } });
  });
  return updateCardState(ctx, input);
}

/** The right alone: stopping never depends on being able to read the Customer Update. */
const mayStop = (ctx: BusinessContext): boolean => isAdminRole(ctx.role) && hasSectionAccess(ctx.membership, "product", "write");

/**
 * `journey.unshareUpdate`: deletes the card; its address answers not found. Refused only for who is asking: nothing
 * about the Customer Update, the page or the payment is read first, so nothing there can keep a card public.
 */
export async function unshareUpdate(ctx: BusinessContext, input: { journeyId: string }): Promise<{ journeyId: string; stopped: boolean }> {
  if (!mayStop(ctx)) throw REFUSAL_ERRORS.role();
  const stopped = await ctx.db.transaction(async (tx) => {
    const card = await repos.updateCards.remove(tx, ctx.businessId, input.journeyId);
    if (!card) return false;
    const url = updateCardUrl(ctx.env.APP_URL, card.id);
    const slug = (await repos.pages.get(tx, ctx.businessId))?.slug ?? null;
    // An event names the page's address; a card removed after the page row was deleted has none to name.
    if (slug) await emit(tx, ctx, { type: "customer_update.unshared", payload: { cardId: card.id, journeyId: input.journeyId, slug, url, hasNote: card.note !== null } });
    await audit(tx, ctx, { action: "customer_update.unshared", target: { kind: "journey", id: input.journeyId }, details: { cardId: card.id, slug, url } });
    return true;
  });
  return { journeyId: input.journeyId, stopped };
}

/** `publicPage.updateCardById`: one shared Customer Update with its project, as anyone may read it. */
export interface PublicUpdateCardView extends PublicMilestoneProject {
  card: UpdateCardFacts & { id: string; note: string | null; url: string };
}

const CardId = z.guid();

/** Null for an unknown id, a Customer Update that is not shared and a project whose page is not public (all read the same). */
export async function publicUpdateCardById(ctx: PublicContext, id: string): Promise<PublicUpdateCardView | null> {
  const clean = id.trim().toLowerCase();
  if (!CardId.safeParse(clean).success) return null;
  return limitedRead(ctx, "Card view", "public-update-card", clean, async () => {
    const card = await repos.updateCards.public.byId(ctx.db, clean);
    if (!card) return null;
    const project = await projectFacts(ctx, card.slug);
    if (!project) return null;
    return { ...project, card: { id: card.id, headline: card.headline, occurredOn: card.occurredOn, leadChannelKey: card.leadChannelKey, standoutAgent: card.standoutAgent, note: card.note, url: updateCardUrl(ctx.env.APP_URL, card.id) } };
  });
}
