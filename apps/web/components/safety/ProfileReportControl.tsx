"use client";
/**
 * The Report control under a person's public page (/u/<handle>; docs/NETWORK.md F21). Shown only to a signed-in visitor
 * who is not the page's own person (`report.canReportProfile`): signed out, it renders nothing, and the owner never sees
 * a Report control on their own page. It says nothing about people or partnering, so a solo founder's page reads the same.
 */
import { useQuery } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { useState } from "react";
import { Button } from "@foundmill/dugout";
import { useTRPC } from "@/lib/trpc-react";
import { ReportPersonDialog, type ReportTarget } from "./ReportPersonDialog";

export function ProfileReportControl({ handle, name }: { handle: string; name: string }) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.report.canReportProfile.queryOptions({ handle }, { retry: false, staleTime: 60_000 }),
  );
  const [target, setTarget] = useState<ReportTarget | null>(null);
  if (!q.data?.canReport) return null;
  return (
    <div className="bg-canvas" data-testid="profile-report">
      <div className="mx-auto flex w-full max-w-reading justify-end px-gutter pb-10">
        <Button
          variant="ghost"
          size="sm"
          className="min-h-tap"
          icon={Flag}
          onClick={() => setTarget({ kind: "profile", handle })}
          data-testid="profile-report-open"
        >
          Report
        </Button>
      </div>
      <ReportPersonDialog target={target} name={name} onOpenChange={(o) => !o && setTarget(null)} />
    </div>
  );
}
