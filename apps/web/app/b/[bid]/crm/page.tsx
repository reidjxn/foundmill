import type { Metadata } from "next";
import { Suspense } from "react";
import { CrmScreen } from "@/components/crm/CrmScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";
import { SCREEN_TITLES } from "@/lib/page-titles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: SCREEN_TITLES.crm };

/** /b/[bid]/crm — CRM list and universal search (BUILD §6.2, §11.12). */
export default function CrmPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <CrmScreen />
    </Suspense>
  );
}
