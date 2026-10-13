import type { Metadata } from "next";
import { DepartmentScreen } from "@/components/screen/DepartmentScreen";
import { departmentTitle } from "@/lib/page-titles";
import { serverDepartments } from "@/lib/trpc-server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Promise<{ bid: string; deptSlug: string; tabSlug: string }>;

/** "Cash · Finance": the department and tab names from the list the layout already loaded (one shared call). */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { bid, deptSlug, tabSlug } = await params;
  if (!UUID_RE.test(bid)) return { title: departmentTitle([], deptSlug, tabSlug) };
  const departments = await serverDepartments(bid).catch(() => null);
  return { title: departmentTitle(departments ?? [], deptSlug, tabSlug) };
}

/** Department screens rendered from screen_definitions (BUILD §6.2, ARCHITECTURE §14). `?view=` picks a sub-view. */
export default async function DepartmentTabPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ deptSlug, tabSlug }, sp] = await Promise.all([params, searchParams]);
  const view = typeof sp.view === "string" ? sp.view : undefined;
  return <DepartmentScreen deptSlug={deptSlug} tabSlug={tabSlug} subView={view} />;
}
