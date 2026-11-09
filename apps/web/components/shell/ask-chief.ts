/**
 * The pure parts of the "Ask <Chief of Staff>" control (the host is AskChief.tsx): the page context sent with a question
 * and the first message of "Continue in chat". Kept apart so they are tested without a browser.
 */
import { CHIEF_PURPOSE_MAX, CHIEF_QUESTION_LABELS, type ChiefPage, type ChiefQuestion } from "@foundmill/shared";
import { FIXED_TAB_AREA, areaOfTab, type AreaKey } from "@foundmill/shared/areas";
import type { DeptColourToken } from "@foundmill/shared";

interface DepartmentForArea {
  slug: string;
  moduleKeys?: readonly string[] | null;
}

/** The area a business path belongs to: a department tab's by its module, Contacts' and Milestones' by their fixed surface. */
export function areaOfPath(path: string, departments: readonly DepartmentForArea[]): AreaKey | null {
  const segments = (path.split(/[?#]/)[0] ?? "").split("/").filter(Boolean);
  const rest = segments[0] === "b" ? segments.slice(2) : segments;
  if (rest[0] === "d" && rest[1]) {
    const department = departments.find((d) => d.slug === rest[1]);
    return department ? areaOfTab(department.moduleKeys, rest[2] ?? "") : null;
  }
  if (rest[0] === "crm") return FIXED_TAB_AREA.crm;
  if (rest[0] === "milestones" || rest[0] === "trophies") return FIXED_TAB_AREA.milestones;
  return null;
}

/** What the page is, for `chiefOfStaff.answer`: its path, area, and the registered screen's id and purpose line (plain text only). */
export function pageContextFor(path: string, departments: readonly DepartmentForArea[], explain?: { screenId: string; purpose: unknown } | null): ChiefPage {
  const purpose = explain && typeof explain.purpose === "string" && explain.purpose.length <= CHIEF_PURPOSE_MAX ? explain.purpose : null;
  return { path: path.slice(0, 300), screenId: explain?.screenId ?? null, area: areaOfPath(path, departments), purpose };
}

/** The desk's first message for "Continue in chat": the question as the founder read it. */
export const continueText = (question: ChiefQuestion): string => CHIEF_QUESTION_LABELS[question];

/** The Chief of Staff as the desk wants it, with the department colour of its own department (or the first one's). */
export function chiefDeskPersona(chief: { name: string; role: string | null; avatarSeed: string; personaKey: string | null; id: string; departmentId: string | null }, departments: readonly { id: string; colourToken: string }[]): { name: string; role: string | null; avatarSeed: string; personaKey: string | null; dept: DeptColourToken } {
  const dept = (departments.find((d) => d.id === chief.departmentId) ?? departments[0])?.colourToken ?? "dept-1";
  return { name: chief.name, role: chief.role, avatarSeed: chief.avatarSeed || chief.id, personaKey: chief.personaKey, dept: dept as DeptColourToken };
}
