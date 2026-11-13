/**
 * "You're on the list." (THESIS_REVIEW package 2.2; DESIGN §9h): what a signed-in person the admission did not let in
 * today reads, wherever the api's `on_waitlist` refusal meets them (apps/web components/shell/ApiErrorPage.tsx), from
 * 390 px. The two lines, the address that signed in, and the caller's way on (Sign out, a link onward). Every control
 * at least 44 px tall (`min-h-tap`). Presentational and server-safe; it offers nothing to join (the retention team's
 * waitlist owns joining it).
 */
import { useId, type ReactNode } from "react";
import { Hourglass } from "lucide-react";
import { ON_WAITLIST_WORDS } from "@foundmill/shared/allowlist";
import { cn } from "../../lib/cn";
import { Icon } from "../foundation/Icon";

export interface OnWaitlistCardProps {
  /** The email address that signed in, so the person knows which one this is about. */
  email?: string | null;
  /** The way on (buttons or links). */
  actions?: ReactNode;
  className?: string;
}

export function OnWaitlistCard({ email, actions, className }: OnWaitlistCardProps) {
  const id = useId();
  return (
    <section data-on-waitlist="" aria-labelledby={`${id}-title`} className={cn("flex min-w-0 flex-col gap-4 rounded-md border border-line bg-panel p-4 @page-wide:p-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-sm bg-panel-alt text-kit">
          <Icon icon={Hourglass} size={16} />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id={`${id}-title`} className="t-title min-w-0 break-words text-primary">
            {ON_WAITLIST_WORDS.title}
          </h1>
          <p role="status" className="t-body break-words text-secondary">
            {ON_WAITLIST_WORDS.body}
          </p>
          {email ? <p className="t-small break-words text-tertiary">{email}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex min-w-0 flex-col gap-2 @page-wide:flex-row @page-wide:flex-wrap">{actions}</div> : null}
    </section>
  );
}
