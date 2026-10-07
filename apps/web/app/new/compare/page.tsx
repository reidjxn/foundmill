/** /new/compare?ids=a,b[,c,d] — side-by-side attributes, radar and the agent verdict (BUILD §11.1, AC-11.1.4). */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CompareScreen } from "@/components/new/compare/CompareScreen";
import { loadStudioViewer } from "@/components/new/viewer.server";
import { UnreachablePage } from "@/components/shell/UnreachablePage";

export const metadata: Metadata = { title: "Compare concepts" };
export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const result = await loadStudioViewer();
  if (result.kind === "signed_out") redirect("/login?next=%2Fnew%2Fcompare");
  if (result.kind === "unreachable") return <UnreachablePage message={result.message} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  return (
    <Suspense fallback={null}>
      <CompareScreen viewer={{ email: viewer.email }} />
    </Suspense>
  );
}
