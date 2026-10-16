import { Suspense } from "react";
import { CrmScreen } from "@/components/crm/CrmScreen";
import { ScreenSkeleton } from "@/components/shell/ScreenSkeleton";

export const dynamic = "force-dynamic";

/** /b/[bid]/crm — CRM list and universal search (BUILD §6.2, §11.12). */
export default function CrmPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <CrmScreen />
    </Suspense>
  );
}
