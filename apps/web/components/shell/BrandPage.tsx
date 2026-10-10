"use client";
/**
 * A signed-in page outside a business (today: an address with no business behind it) in the brand frame: one line
 * saying what happened and one way on (DESIGN §10). Server pages pass the icon by name: component objects cannot cross
 * the server → client boundary.
 */
import { ArrowRight, SearchX, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import { Button, EmptyState } from "@foundmill/dugout";
import { BrandFrame } from "./BrandFrame";

export const BRAND_PAGE_ICONS = { user: UserRound, sparkles: Sparkles, "search-x": SearchX } satisfies Record<string, LucideIcon>;
export type BrandPageIcon = keyof typeof BRAND_PAGE_ICONS;

export interface BrandPageProps {
  /** The panel title ("Not found"). */
  title: string;
  /** The one-line heading of the message; defaults to the title. */
  heading?: string;
  description: string;
  icon: BrandPageIcon;
  /** The way on: a plain link (default: your businesses at "/"). */
  action?: { label: string; href: string };
}

export function BrandPage({ title, heading, description, icon, action = { label: "Go to your business", href: "/" } }: BrandPageProps) {
  return (
    <BrandFrame title={title} footer={<a className="text-link hover:underline" href="/auth/signout">Sign out</a>}>
      <div data-testid="coming-soon">
        <EmptyState
          icon={BRAND_PAGE_ICONS[icon]}
          title={heading ?? title}
          actions={
            <Button asChild size="sm" variant="primary" iconRight={ArrowRight}>
              <a href={action.href}>{action.label}</a>
            </Button>
          }
        >
          {description}
        </EmptyState>
      </div>
    </BrandFrame>
  );
}
