import { redirect } from "next/navigation";

/** /b/[bid] → Today, the business's front door (founder, 2026-11-07). */
export default async function BusinessIndex({ params }: { params: Promise<{ bid: string }> }) {
  const { bid } = await params;
  redirect(`/b/${bid}/today`);
}
