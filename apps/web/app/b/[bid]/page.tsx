import { redirect } from "next/navigation";

/** /b/[bid] → Home. */
export default async function BusinessIndex({ params }: { params: Promise<{ bid: string }> }) {
  const { bid } = await params;
  redirect(`/b/${bid}/home`);
}
