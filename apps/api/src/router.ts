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
import { importRouter } from "./routers/import";
import { inboxRouter, planRouter } from "./routers/inbox";
import { integrationsRouter, keysRouter } from "./routers/integrations";
import { journeyRouter } from "./routers/journey";
import { legalRouter } from "./routers/legal";
import { liveRouter } from "./routers/live";
import { pageRouter, publicPageRouter } from "./routers/page";
import { productRouter } from "./routers/product";
import { teamRouter } from "./routers/team";
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
  publicPerson: publicPersonRouter,
  today: todayRouter,
  chiefOfStaff: chiefOfStaffRouter,
  dev: devRouter,
  distribution: distributionRouter,
  finance: financeRouter,
  team: teamRouter,
  // agent.conversation.* (the agent's desk) sits beside agent.profile/training/model/autonomy/negotiation.
  agent: mergeRouters(agentRouter, router({ conversation: conversationRouter, speechAccent: speechAccentRouter })),
  teamCall: teamCallRouter,
  legal: legalRouter,
  crm: crmRouter,
  integrations: integrationsRouter,
  keys: keysRouter,
  billing: billingRouter,
  live: liveRouter,
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
