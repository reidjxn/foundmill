/**
 * /new — Create a new business: Door A (Ideation Studio) or Door B (Import), a third door to the example business when
 * the deployment has one (docs/UX_AUDIT_AND_PLAN.md §12 item 5), with Back to the business the founder came from. The
 * founder profile gate (AC-11.1.1) applies here too: a founder without a profile is sent to /onboarding first,
 * because every concept is drafted within their constraints.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Doors, type ExampleDoor } from "@/components/new/Doors";
import { loadStudioViewer, profileLineOf } from "@/components/new/viewer.server";
import { ApiErrorPage } from "@/components/shell/ApiErrorPage";
import { pickCurrentBusiness } from "@/lib/auth/current-business";
import { getLastBusinessId } from "@/lib/auth/server";
import { serverApi } from "@/lib/trpc-server";

export const metadata: Metadata = { title: "Create a new business" };
export const dynamic = "force-dynamic";

/**
 * The example business for the third door (`business.example.get`), asked in the same batch as the profile. Null when
 * the deployment has none, and null when the read fails: the two doors never wait on the example.
 */
async function loadExampleDoor(): Promise<ExampleDoor | null> {
  const server = await serverApi();
  if (!server) return null;
  try {
    const example = await server.api.business.example.get.query();
    return example ? { id: example.id, name: example.name, membership: example.membership } : null;
  } catch {
    return null;
  }
}

export default async function NewBusinessPage() {
  const [result, example] = await Promise.all([loadStudioViewer(), loadExampleDoor()]);
  if (result.kind === "signed_out") redirect("/login?next=%2Fnew");
  if (result.kind === "unreachable") return <ApiErrorPage error={result.error} email={result.email} />;
  const { viewer } = result;
  if (!viewer.complete) redirect("/onboarding");
  // The business the founder came from (Switch business › Create a new business): the doors offer the way back to it.
  const last = pickCurrentBusiness(await getLastBusinessId(), viewer.businesses);
  // The experience comes with the page (the profile is already read here), so Door A's "Recommended for you" tag for a
  // first-time founder paints with the page instead of after a second read of the profile (§7.4).
  return (
    <Doors
      viewer={{ email: viewer.email }}
      profileLine={profileLineOf(viewer.profile)}
      experience={viewer.profile?.experience ?? null}
      businessCount={viewer.businesses.length}
      backTo={last ? { id: last.id, name: last.name } : null}
      example={example}
    />
  );
}
