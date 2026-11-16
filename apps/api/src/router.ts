/** The merged AppRouter (BUILD §8.3 names) and a caller factory for tests and in-process use. */
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { ApiDeps, CallerUser } from "./context";
import { createTestContext } from "./context";
import { agentRouter } from "./routers/agent";
import { billingRouter } from "./routers/billing";
import { businessRouter } from "./routers/business";
import { crmRouter } from "./routers/crm";
import { cycleRouter } from "./routers/cycle";
import { dashboardRouter, departmentRouter, screenRouter } from "./routers/department";
import { devRouter } from "./routers/dev";
import { emailRouter } from "./routers/email";
import { distributionRouter } from "./routers/distribution";
import { financeRouter } from "./routers/finance";
import { founderRouter, publicPersonRouter } from "./routers/founder";
import { goalRouter } from "./routers/goal";
import { ideaRouter } from "./routers/idea";
import { ideaBoxRouter, waitlistRouter } from "./routers/idea-box";
import { importRouter } from "./routers/import";
import { inboxRouter, planRouter } from "./routers/inbox";
import { integrationsRouter, keysRouter } from "./routers/integrations";
import { journeyRouter } from "./routers/journey";
import { legalRouter } from "./routers/legal";
import { liveRouter } from "./routers/live";
import { operatorRouter, reportRouter } from "./routers/report";
import { pageRouter, publicPageRouter } from "./routers/page";
import { pageQuizRouter, publicQuizRouter } from "./routers/page-quiz";
import { productRouter } from "./routers/product";
import { shareRouter } from "./routers/share";
import { showcaseRouter } from "./routers/showcase";
import { teamRouter } from "./routers/team";
import { invitationRouter } from "./routers/people";
import { todayRouter } from "./routers/today";
import { chiefOfStaffRouter } from "./routers/chief-of-staff";
import { conversationRouter } from "./routers/conversation";
import { speechAccentRouter, teamCallRouter } from "./routers/team-call";
import { createCallerFactory, mergeRouters, publicProcedure, router } from "./trpc";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  founder: founderRouter,
  email: emailRouter,
  idea: ideaRouter,
  business: businessRouter,
  cycle: cycleRouter,
  import: importRouter,
  department: departmentRouter,
  screen: screenRouter,
  dashboard: dashboardRouter,
  inbox: inboxRouter,
  plan: planRouter,
  journey: journeyRouter,
  product: productRouter,
  goal: goalRouter,
  page: pageRouter,
  publicPage: publicPageRouter,
  // The optional quiz on a public page (0105): the console's review, approve and on/off, and the signed-out read and count.
  pageQuiz: pageQuizRouter,
  publicQuiz: publicQuizRouter,
  // Tap-to-post: a pressed share control, recorded as a share that was opened (services/shares.ts).
  share: shareRouter,
  showcase: showcaseRouter,
  publicPerson: publicPersonRouter,
  today: todayRouter,
  ideaBox: ideaBoxRouter,
  waitlist: waitlistRouter,
  chiefOfStaff: chiefOfStaffRouter,
  dev: devRouter,
  distribution: distributionRouter,
  finance: financeRouter,
  team: teamRouter,
  // The way in: invitations to a project (routers/people.ts).
  invitation: invitationRouter,
  // agent.conversation.* (the agent's desk) sits beside agent.profile/training/model/autonomy/negotiation.
  agent: mergeRouters(agentRouter, router({ conversation: conversationRouter, speechAccent: speechAccentRouter })),
  teamCall: teamCallRouter,
  legal: legalRouter,
  crm: crmRouter,
  integrations: integrationsRouter,
  keys: keysRouter,
  billing: billingRouter,
  live: liveRouter,
  report: reportRouter,
  operator: operatorRouter,
});

export type AppRouter = typeof appRouter;
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;

const callerFactory = createCallerFactory(appRouter);

/** In-process caller: `createCaller(deps, { userId })` then `caller.inbox.list({ businessId })`. */
export function createCaller(deps: ApiDeps, user: CallerUser | null) {
  return callerFactory(createTestContext(deps, user));
}
export type Caller = ReturnType<typeof createCaller>;
