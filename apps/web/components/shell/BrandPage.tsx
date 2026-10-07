"use client";
/**
 * A signed-in page outside a business (onboarding, new business, not found) in the brand frame with a coming-soon
 * body. Server pages pass the icon by name: component objects cannot cross the server → client boundary.
 */
import { SearchX, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import { EmptyState } from "@foundmill/dugout";
import { BrandFrame } from "./BrandFrame";

export const BRAND_PAGE_ICONS = { user: UserRound, sparkles: Sparkles, "search-x": SearchX } satisfies Record<string, LucideIcon>;
export type BrandPageIcon = keyof typeof BRAND_PAGE_ICONS;

export function BrandPage({ title, description, icon }: { title: string; description: string; icon: BrandPageIcon }) {
  return (
    <BrandFrame footer={<a className="text-link hover:underline" href="/auth/signout">Sign out</a>}>
      <div className="flex h-8 items-center border-b border-subtle bg-panel-alt px-3">
        <span className="t-label">{title}</span>
      </div>
      <div className="p-5" data-testid="coming-soon">
        <EmptyState icon={BRAND_PAGE_ICONS[icon]} title={`${title} is coming in this build`}>
          {description}
        </EmptyState>
      </div>
    </BrandFrame>
  );
}
