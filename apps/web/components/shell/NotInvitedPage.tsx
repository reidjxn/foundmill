"use client";
/**
 * Rendered by server pages when the API refuses the signed-in account because this deployment is invite-only (the API's
 * SIGNUP_ALLOWLIST, appCode `not_invited`): says so plainly, names the address that signed in, and offers to sign out
 * so the founder can use an address that is on the list. A listed address the sign-in did not show as confirmed
 * (`unconfirmed`) is asked to confirm it first.
 */
import { MailX } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { Button, EmptyState } from "@foundmill/dugout";
import { BrandFrame } from "./BrandFrame";

export function NotInvitedPage({ message, email, unconfirmed = false }: { message: string; email?: string | null; unconfirmed?: boolean }) {
  const title = unconfirmed ? (email ? `Confirm ${email} first` : "Confirm your address first") : email ? `${email} is not on the list` : "This address is not on the list";
  return (
    <BrandFrame title="Invite only for now" footer={<span>{APP_NAME} is open to invited founders while it is in preview.</span>}>
      <div data-testid="not-invited" data-reason={unconfirmed ? "email_unconfirmed" : "not_listed"}>
        <EmptyState icon={MailX} title={title}>
          {message}
        </EmptyState>
        <div className="mt-3 flex justify-end">
          <Button variant="default" size="sm" asChild>
            <a href="/auth/signout">Sign out</a>
          </Button>
        </div>
      </div>
    </BrandFrame>
  );
}
