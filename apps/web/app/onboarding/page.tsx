import type { Metadata } from "next";
import { BrandPage } from "@/components/shell/BrandPage";

export const metadata: Metadata = { title: "Founder profile" };

/** Replaced by the onboarding build (BUILD §11.1); the route exists so AC-11.1.1 redirects land somewhere real. */
export default function OnboardingPage() {
  return <BrandPage title="Founder profile" icon="user" description="Experience, skills, time, budget, markets and constraints: the profile every new business starts from. The onboarding build adds the form here." />;
}
