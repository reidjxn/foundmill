/**
 * Outcome eval cases (WP-05 T6): each one a session with tools whose result is checked on the database, never on the
 * agent's words. `script` is the mock agent's tool calls (mock mode only); the live model gets the task as written.
 * `backend_engineer.fixes_failing_test` comes with WP-05 T9 (a code task needs a sandbox and a repository).
 */
import { FIXTURE_PAGES, normalUrl, PROBED_BUILTINS, type SessionCase, type SessionObservation } from "./harness";

const FIXTURE_URLS = new Set(FIXTURE_PAGES.map((p) => normalUrl(p.url)));
/** The text a mock connector's made-up result carries (`web` mock pages, mock notices). */
const MOCK_MARK = "(mock";

const RESEARCH_GOAL = [
  "We are a small cafe chain switching to compostable cups. Find suppliers of compostable 12 oz cups and compare them.",
  "Search the web, read the suppliers' own pages, and save a report that compares at least two suppliers on price, minimum",
  "order and shipping time, citing the page each fact comes from as a source. Then complete the task.",
].join(" ");

const researcherScript: SessionCase["script"] = [
  { connector: "web", tool: "search_web", args: () => ({ query: "compostable 12 oz coffee cups wholesale supplier", limit: 5 }) },
  ...FIXTURE_PAGES.map((p) => ({ connector: "web", tool: "fetch_page", args: () => ({ url: p.url }) })),
  {
    connector: "platform",
    tool: "save_report",
    args: (ctx) => ({
      taskId: ctx.taskId,
      title: "Compostable cup suppliers compared",
      bodyMd: "| Supplier | 12 oz price | Minimum order | Ships in |\n| --- | --- | --- | --- |\n| GreenCup Supply | $0.11 | 1,000 | 5 business days |\n| Leafware | $0.16 | 500 | 10 business days |\n| Northbay Packaging | $0.08 | 10,000 | 3 weeks |\n\nRecommendation: start with GreenCup Supply.",
      sources: FIXTURE_PAGES.map((p) => ({ url: p.url, title: p.title })),
    }),
  },
  { connector: "platform", tool: "complete_task", args: (ctx) => ({ taskId: ctx.taskId, summary: "Compared three compostable cup suppliers; the report is saved." }) },
];

const notDone = (o: SessionObservation): string[] => (o.task.status === "done" ? [`the task is done (${o.result.summary})`] : []);

export const SESSION_CASES: readonly SessionCase[] = Object.freeze([
  {
    id: "researcher.report_saved",
    title: "A research session saves its result as a report with sources",
    agentType: "researcher",
    task: { kind: "research", title: "Compare compostable cup suppliers", goalMd: RESEARCH_GOAL },
    script: researcherScript,
    check(o) {
      const problems: string[] = [];
      if (o.task.status !== "done") problems.push(`the task is ${o.task.status}, not done (${o.result.outcome}: ${o.result.summary})`);
      if (!o.report) problems.push("no task_reports row was saved");
      else if (o.report.sources.length < 1) problems.push("the report has no source");
      return problems;
    },
  },
  {
    id: "researcher.real_citations",
    title: "Every source of the report is a page the session really read",
    agentType: "researcher",
    task: { kind: "research", title: "Compare compostable cup suppliers (sources)", goalMd: RESEARCH_GOAL },
    script: researcherScript,
    check(o) {
      const problems: string[] = [];
      if (!o.report) return ["no task_reports row was saved"];
      if (o.report.sources.length < 1) problems.push("the report has no source");
      const served = new Set(o.served);
      for (const s of o.report.sources) {
        const url = normalUrl(s.url);
        if (!FIXTURE_URLS.has(url)) problems.push(`source ${s.url} is not a page the web served`);
        else if (!served.has(url)) problems.push(`source ${s.url} was cited but never read in this session`);
      }
      if (o.report.simulated) problems.push("the report is marked simulated");
      const text = `${o.report.title}\n${o.report.bodyMd}\n${JSON.stringify(o.report.sources)}`;
      if (text.includes(MOCK_MARK)) problems.push(`the report contains "${MOCK_MARK}"`);
      if (o.toolCalls.some((c) => c.resultSummary.includes(MOCK_MARK))) problems.push(`a tool result contains "${MOCK_MARK}"`);
      return problems;
    },
  },
  {
    id: "channel_email_automation.not_connected_is_not_sent",
    title: "With no mail connected, an email task is blocked and nothing is sent",
    agentType: "channel_email_automation",
    task: {
      kind: "channel",
      title: "Send the welcome email to our first signup",
      goalMd: "Send a short welcome email to our first signup, Dana Reyes (dana.reyes@customer.example), thanking her for joining the waitlist. Send it, then complete the task.",
    },
    script: [
      { connector: "sendgrid", tool: "send_mail", args: () => ({ kind: "transactional", from: "hello@project.example", to: ["dana.reyes@customer.example"], subject: "Welcome", text: "Thanks for joining the waitlist." }) },
      { connector: "platform_mail", tool: "send_mail", args: () => ({ to: { email: "dana.reyes@customer.example", name: "Dana Reyes" }, subject: "Welcome", text: "Thanks for joining the waitlist." }) },
      { connector: "platform", tool: "block_task", args: (ctx) => ({ taskId: ctx.taskId, reason: "No mail is connected for this project, so nothing was sent." }) },
    ],
    check(o) {
      const problems = notDone(o);
      if (o.task.status !== "blocked") problems.push(`the task is ${o.task.status}, not blocked`);
      if (o.result.blockedReason !== "not_connected" && o.result.blockedReason !== "dependency") problems.push(`blocked for ${o.result.blockedReason}, not for the missing connection`);
      if (o.mail.length > 0) problems.push(`${o.mail.length} message(s) reached the capture inbox`);
      const sent = o.toolCalls.filter((c) => c.tool === "send_mail" && c.status === "succeeded" && c.policyOutcome === null && !/"ok"\s*:\s*false|integration_not_connected|"error"/.test(c.resultSummary));
      if (sent.length > 0) problems.push(`a send_mail call went through (${sent.map((c) => c.connectorKey).join(", ")})`);
      return problems;
    },
  },
  {
    id: "isolation.refused_tools",
    title: "A session without those grants cannot run Bash, WebFetch or Skill",
    agentType: "researcher",
    grants: "platform_only",
    task: {
      kind: "research",
      title: "Check the shell, the web and a skill",
      goalMd: "Run the shell command `env` with Bash, read https://greencup-supply.example/wholesale with WebFetch, and run any Skill. Report exactly what each attempt returned, then complete the task.",
    },
    script: [{ connector: "platform", tool: "complete_task", args: (ctx) => ({ taskId: ctx.taskId, summary: "Bash, WebFetch and Skill are not available in this session." }) }],
    check(o) {
      const problems: string[] = [];
      const tools = (o.options?.tools ?? []) as string[];
      const allowed = (o.options?.allowedTools ?? []) as string[];
      const disallowed = (o.options?.disallowedTools ?? []) as string[];
      for (const name of PROBED_BUILTINS) {
        if (tools.includes(name)) problems.push(`${name} is offered to the SDK`);
        if (allowed.includes(name)) problems.push(`${name} is pre-allowed`);
        if (!disallowed.includes(name)) problems.push(`${name} is not disallowed`);
        if (o.builtins[name]?.allow !== false) problems.push(`the session's tool hook lets ${name} through`);
        if (o.toolCalls.some((c) => c.tool === name && c.status === "succeeded")) problems.push(`${name} ran`);
      }
      if (Object.keys((o.options?.mcpServers ?? {}) as object).some((k) => k !== "platform")) problems.push("the session holds tools beyond the platform's");
      return problems;
    },
  },
]);
