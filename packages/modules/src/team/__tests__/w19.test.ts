/**
 * Team screen helpers (brief W19): the agent builder puts the right template first (TPD-26), specialists default to
 * Operations (AC-14), Health does not call an all-idle team "everyone is working" (TPD-08), Staff shows a member's
 * walls (RUI-04), the org chart is rooted at the founder and says "You" only to them (RUI-11), and the Chief of Staff is
 * the one the API names (ARB-18).
 */
import { describe, expect, it } from "vitest";
import { healthSummary } from "../HealthScreen";
import { founderOf, toHierarchyNodes } from "../HierarchyScreen";
import { departmentForTemplate, moduleLabel } from "../RecruitmentScreen";
import { isChiefOfStaff, isChiefOfStaffType, suggestTemplates } from "../shared";
import { sectionOverrides, toStaffRows } from "../StaffScreen";
import type { DepartmentRow } from "@foundmill/widgets/shared/types";
import type { MembershipRow, TemplateRow } from "../types";
import { AGENT_COS, AGENT_JUNO, ME, USER_ADA, agents, departments, humans, responsibilities } from "./fixtures";

const template = (key: string, name: string, role: string, family: TemplateRow["family"], description: string, skills: string[]): TemplateRow => ({ key, name, role, family, layer: family === "lead" ? "lead" : "worker", module: "development", modelKey: "sonnet", description, skills, wageCapMinor: 20_000, wageLabel: "Estimate" });

// The three templates the audit saw tie at 60 % (their catalog text, abridged only where it does not change the words).
const builderCatalogue: TemplateRow[] = [
  template("data_engineer", "Data Engineer", "Data engineer", "worker", "I build the pipelines, materialized views, named queries and metrics the product relies on, with data-quality checks and fixtures that prove the numbers. Inputs: task, metric definitions, schema, event catalog. Outputs: migrations and queries with tests against fixtures, documented metric definitions. Tools: sandbox, GitHub read, analytics read. Never does: expose cross-business data, hand-edit production data, or ship a metric without a fixture test.", ["data_pipelines", "data_quality", "sql_analytics", "data_modelling", "testing"]),
  template("docs_writer", "Docs Writer", "Technical writer", "worker", "I write and maintain the documentation that lets a human or an agent use the product and the codebase: READMEs, API references, runbooks, release notes and in-product help, every example tested. Inputs: code, tests, specs, release diffs. Outputs: documentation changes on a branch with examples that run. Tools: sandbox, GitHub read, Notion or Drive write for external docs. Never does: document behavior that does not exist, paste secrets or internal URLs, or publish without review.", ["technical_writing", "information_architecture", "example_quality"]),
  template("quality", "Quality Specialist", "Quality specialist", "specialist", "I write QC specifications and acceptance criteria, set AQL sampling plans, plan pre-shipment and in-process inspections, and run root-cause analysis on defects. Inputs: the product spec, supplier process capability, batch records, inspection reports, customer complaints. Outputs: QC specs with measurable criteria, AQL plans, inspection plans and checklists, inspection reports summarized with record ids, corrective action requests.", ["qc_specs", "aql_sampling", "root_cause"]),
];

describe("suggestTemplates (TPD-26)", () => {
  it("puts Docs Writer first for the audit's sentence, ahead of templates that only share generic words", () => {
    const matches = suggestTemplates("an agent who writes our product documentation and help center articles", builderCatalogue);
    expect(matches[0]?.template.key).toBe("docs_writer");
    expect(matches[0]!.score).toBeGreaterThan(matches[1]?.score ?? 0);
  });

  it("weights the name and role over the description", () => {
    expect(suggestTemplates("a data engineer for our metrics", builderCatalogue)[0]?.template.key).toBe("data_engineer");
    expect(suggestTemplates("quality inspections for our batches", builderCatalogue)[0]?.template.key).toBe("quality");
  });
});

describe("departmentForTemplate (AC-14)", () => {
  const ops: DepartmentRow = { id: "d-ops", name: "Operations", slug: "operations", colourToken: "dept-4", position: 2, moduleKeys: ["development"], leadAgentId: "a-ops", lead: { id: "a-ops", name: "Opal", status: "healthy", avatarSeed: "opal" }, squad: [], tabs: [] };
  const withOps = [...departments, ops];
  const opsLead = [{ id: "a-ops", agentType: "operations_lead" }];
  const specialist = { key: "quality", family: "specialist" as const, module: "development" };

  it("hires a specialist into the department the Operations Lead leads, even when Development comes first", () => {
    expect(departmentForTemplate(specialist, withOps, opsLead)?.id).toBe("d-ops");
    expect(moduleLabel(specialist, withOps, opsLead)).toBe("Operations");
    expect(departmentForTemplate({ key: "operations_lead", family: "lead", module: "development" }, withOps, opsLead)?.id).toBe("d-ops");
  });

  it("an engineer still goes to Development, and without an Operations Lead a specialist falls back to the module's department", () => {
    expect(departmentForTemplate({ key: "frontend_engineer", family: "worker", module: "development" }, withOps, opsLead)?.name).toBe("Development");
    expect(departmentForTemplate(specialist, withOps, [])?.name).toBe("Development");
    expect(moduleLabel({ key: "entity_linker", family: "utility", module: null as unknown as string }, withOps)).toBe("Any");
  });
});

describe("healthSummary (TPD-08)", () => {
  const task = { id: "t1", title: "Ship the export" };
  it("counts the agents with a task as working, the rule Home's team strip uses; health alone is not working", () => {
    expect(healthSummary([{ status: "idle", currentTask: null }, { status: "idle", currentTask: null }])).toEqual({ text: "No agent is working right now", tone: "neutral" });
    // Two healthy agents with nothing to do are not "everyone is working".
    expect(healthSummary([{ status: "healthy", currentTask: null }, { status: "healthy" }])).toEqual({ text: "No agent is working right now", tone: "neutral" });
    expect(healthSummary([{ status: "healthy", currentTask: task }, { status: "degraded", currentTask: task }])).toEqual({ text: "Everyone is working", tone: "good" });
    expect(healthSummary([{ status: "healthy", currentTask: task }, { status: "healthy", currentTask: null }, { status: "idle", currentTask: null }])).toEqual({ text: "1 of 3 working", tone: "good" });
  });
});

describe("Staff walls (RUI-04)", () => {
  it("shows 'no access' sections first instead of 'Role default'", () => {
    const walled: MembershipRow = { id: "m-9", userId: "90000000-0000-4000-8000-000000000009", role: "member", sectionPermissions: { finance: "none", legal: "none", product: "write" }, createdAt: "2026-09-01T09:00:00Z" };
    const [row] = toStaffRows([walled], responsibilities, { userId: ME, displayName: "Reid", email: null });
    expect(row!.none).toEqual(["Finance", "Legal"]);
    expect(sectionOverrides(row!).map((o) => `${o.section} · ${o.word}`)).toEqual(["Finance · no access", "Legal · no access", "Product · write"]);
    expect(sectionOverrides({ none: [], writes: [], reads: [] })).toEqual([]);
  });
});

describe("org chart for co-founders (RUI-11)", () => {
  it("roots the chart at the founder; 'You' only for that person, a co-founder sees themselves among the staff", () => {
    const founder = founderOf(humans)!;
    expect(founder.userId).toBe(ME);
    const asFounder = toHierarchyNodes(agents, { departments, founderName: "Reid", founder, staff: humans, me: { userId: ME, displayName: "Reid", email: null } });
    expect(asFounder[0]).toMatchObject({ kind: "founder", role: "You" });
    const asAda = toHierarchyNodes(agents, { departments, founderName: "Ada", founder, staff: humans, me: { userId: USER_ADA, displayName: "Ada", email: "ada@northwind.example" } });
    expect(asAda[0]).toMatchObject({ kind: "founder", role: "Owner" });
    expect(asAda[0]!.name).not.toBe("Ada");
    expect(asAda.find((n) => n.id === `staff:${USER_ADA}`)).toMatchObject({ role: "Admin · You", parentId: asAda[0]!.id });
    expect(asAda.some((n) => n.id === `staff:${ME}`)).toBe(false);
  });
});

describe("Chief of Staff (ARB-18)", () => {
  it("is the agent the API flags; another assistant-type agent is not the designated one", () => {
    const cos = agents.find((a) => a.id === AGENT_COS)!;
    const second = { ...cos, id: "10000000-0000-4000-8000-0000000000ff", chiefOfStaff: false };
    expect(isChiefOfStaff({ ...cos, chiefOfStaff: true })).toBe(true);
    expect(isChiefOfStaff(second)).toBe(false);
    // Clone stays off for every chief-type agent, designated or not.
    expect(isChiefOfStaffType(second)).toBe(true);
    expect(isChiefOfStaffType(agents.find((a) => a.id === AGENT_JUNO)!)).toBe(false);
  });
});
