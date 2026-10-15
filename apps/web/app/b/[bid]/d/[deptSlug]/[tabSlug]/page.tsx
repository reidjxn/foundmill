import { DepartmentScreen } from "@/components/screen/DepartmentScreen";

export const dynamic = "force-dynamic";

type Params = Promise<{ bid: string; deptSlug: string; tabSlug: string }>;

/** Department screens rendered from screen_definitions (BUILD §6.2, ARCHITECTURE §14). `?view=` picks a sub-view. */
export default async function DepartmentTabPage({ params, searchParams }: { params: Params; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ deptSlug, tabSlug }, sp] = await Promise.all([params, searchParams]);
  const view = typeof sp.view === "string" ? sp.view : undefined;
  return <DepartmentScreen deptSlug={deptSlug} tabSlug={tabSlug} subView={view} />;
}
