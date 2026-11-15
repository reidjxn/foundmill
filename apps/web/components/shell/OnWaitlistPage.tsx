"use client";
/**
 * The api's `on_waitlist` refusal (services/access.ts: the admission did not let the signed-in person in today), shown
 * by `ApiErrorPage` in place of whatever page they opened, from 390 px (CLAUDE.md "Small screens": sign-in and what it
 * leads to). The design system's `OnWaitlistCard` in the brand frame: "You're on the list." and what is true now
 * (`ON_WAITLIST_WORDS`: no email is promised until the waitlist records who waits), the address that signed in, Sign
 * out, and a link onward (an example project to look around).
 *
 * `WorksOnSmallScreens` keeps the root's `DesktopOnly` from asking for a larger window on whatever route this is.
 * The not-invited page (`not_invited`, NotInvitedPage.tsx) is a separate refusal; both store the person on the waitlist
 * on arrival with its `WaitlistJoin`.
 */
import { Button, OnWaitlistCard } from "@foundmill/dugout";
import { APP_NAME } from "@foundmill/config";
import { WorksOnSmallScreens } from "@/components/providers/DesktopOnly";
import { ON_WAITLIST_ONWARD_HREF } from "@/lib/people";
import { BrandFrame } from "./BrandFrame";
import { WaitlistJoin } from "./NotInvitedPage";
import { SignOutButton } from "./SignOutButton";

export interface OnWaitlistPageProps {
  email?: string | null;
  /** Where the link onward goes (an example project by default). */
  onwardHref?: string;
}

export function OnWaitlistPage({ email = null, onwardHref = ON_WAITLIST_ONWARD_HREF }: OnWaitlistPageProps) {
  return (
    <BrandFrame smallScreen footer={<span>{APP_NAME} lets new people in every day.</span>}>
      <WorksOnSmallScreens />
      <div className="@container" data-testid="on-waitlist">
        <OnWaitlistCard
          email={email}
          actions={
            <>
              <SignOutButton variant="secondary" size="lg" className="min-h-tap" />
              <Button asChild variant="ghost" size="lg" className="min-h-tap">
                <a href={onwardHref}>Look around an example</a>
              </Button>
            </>
          }
        />
        {/* The person refused by the day's ceiling is stored too, once, on arrival (WP-03 T1). */}
        <WaitlistJoin />
      </div>
    </BrandFrame>
  );
}
