import { redirect } from "next/navigation";

/** BUILD §6.2 names this route /trophies; the product vocabulary says Milestones, so the old path forwards. */
export default async function TrophiesRedirect({ params }: { params: Promise<{ bid: string }> }) {
  const { bid } = await params;
  redirect(`/b/${bid}/milestones`);
}
