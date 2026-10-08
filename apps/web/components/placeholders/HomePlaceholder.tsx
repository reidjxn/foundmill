"use client";
import { LayoutDashboard } from "lucide-react";
import { useShellChrome } from "@/components/shell/chrome";
import { ComingSoon } from "@/components/shell/ComingSoon";

export function HomePlaceholder({ dashboardId }: { dashboardId?: string }) {
  useShellChrome({ title: "Home" });
  return <ComingSoon title="Home" icon={LayoutDashboard} description="The Journey Ribbon, the status strip, department cards, the team pulse and the inbox preview. The Home build renders your dashboards here." detail={dashboardId ? `dashboard ${dashboardId}` : undefined} />;
}
