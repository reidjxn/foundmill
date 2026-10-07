import type { Metadata } from "next";
import { BrandPage } from "@/components/shell/BrandPage";

export const metadata: Metadata = { title: "New business" };

export default function NewBusinessPage() {
  return <BrandPage title="New business" icon="sparkles" description="Door A ideates a concept in the Ideation Studio; Door B imports what already exists. Both doors arrive with the onboarding build." />;
}
