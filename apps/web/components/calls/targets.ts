/**
 * Where a filed action of a finished call opens (docs/TEAM_CALL.md §6): a task on the Plan of the department that runs
 * development, a roadmap item on the Roadmap of the department that holds Product, a plan on the Inbox note that waits
 * for the go-ahead. Departments are found by their modules, never by name.
 */
import { routes } from "@foundmill/widgets/shared/routes";
import { moduleTab, taskHref, type DepartmentForLinks } from "@/components/inbox/logic";

export type CallTarget = { kind: "task" | "roadmap_item" | "plan"; id: string };

export function callTargetHref(businessId: string, departments: readonly DepartmentForLinks[], target: CallTarget): string {
  switch (target.kind) {
    case "task":
      return taskHref(businessId, departments, target.id) ?? routes.today(businessId);
    case "roadmap_item": {
      const t = moduleTab(departments, "product", "roadmap");
      return t ? routes.department(businessId, t.slug, t.tab) : routes.today(businessId);
    }
    case "plan":
      // The staged plan waits in the Inbox on what needs the founder's answer.
      return `${routes.inbox(businessId)}?tab=respond`;
  }
}
