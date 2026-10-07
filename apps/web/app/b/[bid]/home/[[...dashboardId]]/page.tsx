import { HomeScreen } from "@/components/home/HomeScreen";

export const dynamic = "force-dynamic";

/** /b/[bid]/home[/[dashboardId]] — Home dashboards (BUILD §11.2). */
export default async function HomePage({ params }: { params: Promise<{ bid: string; dashboardId?: string[] }> }) {
  const { dashboardId } = await params;
  return <HomeScreen dashboardId={dashboardId?.[0]} />;
}
