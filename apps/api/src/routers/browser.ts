/**
 * browser.sessions/takeOver/handBack/stop and browserStep.get (founder, Nov 22, 2026): Working now's "Working in <site>"
 * rows and the page-before screenshot on a hard-gate note. Watching needs the Development section's read; stopping needs
 * its write, as stopping an agent does. The live view, taking over and handing back are for the people who may connect
 * the site (owner, cofounders, admins): whoever has the page controls the founder's signed-in account. Stop all agents ends every session too
 * (services/killswitch.ts).
 */
import { browserSite } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import { ADMIN_ROLES, ForbiddenError, NotFoundError, hasSectionAccess } from "@foundmill/shared";
import { z } from "zod";
import { BROWSER_NOT_AVAILABLE, browserControl, listBrowserSessions } from "../services/browser";
import { Id, audit, router, sectionRead, sectionWrite } from "../trpc";

const read = sectionRead("development");
const write = sectionWrite("development");
const SiteKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);

export { BROWSER_NOT_AVAILABLE };

const CONTROL_REFUSED = "Only the people who may connect this website can take over or hand back its page.";
/** Who may hold the page: the roles that may connect the site, with write on Development. */
const mayControl = (ctx: { role: Parameters<typeof ADMIN_ROLES.includes>[0]; membership: Parameters<typeof hasSectionAccess>[0] }) => ADMIN_ROLES.includes(ctx.role) && hasSectionAccess(ctx.membership, "development", "write");

export const browserRouter = router({
  /** The project's running sessions. A member who may only read gets the sessions without their live view. */
  sessions: read.query(async ({ ctx }) => {
    const canControl = mayControl(ctx);
    return { canControl, sessions: await listBrowserSessions(ctx.gateway, ctx.businessId, canControl) };
  }),

  /** The founder takes the page: the team's steps wait until it is handed back. */
  takeOver: write.input(z.object({ siteKey: SiteKey })).mutation(async ({ ctx, input }) => {
    if (!mayControl(ctx)) throw new ForbiddenError(CONTROL_REFUSED);
    const out = await browserControl(ctx.gateway.browserTakeOver ? () => ctx.gateway.browserTakeOver!(ctx.businessId, input.siteKey) : null);
    await ctx.rls((tx) => audit(tx, ctx, { action: "browser.take_over", target: { kind: "browser_session", siteKey: input.siteKey }, details: { siteKey: input.siteKey } }));
    return out;
  }),

  handBack: write.input(z.object({ siteKey: SiteKey })).mutation(async ({ ctx, input }) => {
    if (!mayControl(ctx)) throw new ForbiddenError(CONTROL_REFUSED);
    const out = await browserControl(ctx.gateway.browserHandBack ? () => ctx.gateway.browserHandBack!(ctx.businessId, input.siteKey) : null);
    await ctx.rls((tx) => audit(tx, ctx, { action: "browser.hand_back", target: { kind: "browser_session", siteKey: input.siteKey }, details: { siteKey: input.siteKey } }));
    return out;
  }),

  stop: write.input(z.object({ siteKey: SiteKey })).mutation(async ({ ctx, input }) => {
    const out = await browserControl(ctx.gateway.browserStop ? () => ctx.gateway.browserStop!(ctx.businessId, input.siteKey) : null);
    await ctx.rls((tx) => audit(tx, ctx, { action: "browser.stop", target: { kind: "browser_session", siteKey: input.siteKey }, details: { siteKey: input.siteKey, stopped: out.stopped } }));
    return out;
  }),
});

// The page before a press can show anything the site shows: the same wall as watching the session.
const inboxRead = sectionRead("development");

export const browserStepRouter = router({
  /** One step of the record with the page as it was before the press (a hard-gate note's screenshot); not-found for another project's step. */
  get: inboxRead.input(z.object({ stepId: Id })).query(async ({ ctx, input }) => {
    const step = await ctx.rls((tx) => repos.browserSteps.get(tx, ctx.businessId, input.stepId));
    if (!step) throw new NotFoundError("That step");
    const { screenshot } = step;
    return {
      siteKey: step.siteKey,
      siteName: browserSite(step.siteKey)?.name ?? step.siteKey,
      target: step.target,
      class: step.class,
      why: step.why,
      url: step.url,
      amount: step.amount,
      simulated: step.simulated,
      createdAt: step.createdAt,
      screenshotDataUrl: screenshot && screenshot.length > 0 ? `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}` : null,
    };
  }),
});
