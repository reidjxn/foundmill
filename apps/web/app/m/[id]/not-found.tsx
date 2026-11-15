/**
 * No milestone card at this address (hidden again, never shown, its project's page taken down, or never existed: the
 * same answer for each, so nothing leaks about a milestone that is not public). Signed out and from 390 px like the
 * card itself, so a phone is never left at a dead end: the one way on is the site's home.
 */
import { SearchX } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { EmptyState } from "@foundmill/dugout";

export default function MilestoneCardNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-gutter" data-testid="milestone-card-not-found">
      <EmptyState
        icon={SearchX}
        title="No milestone here"
        actions={
          <a href="/" className="btn-secondary t-action inline-flex min-h-tap items-center rounded-sm px-btn-md text-primary focus-ring">
            {`Go to ${APP_NAME}`}
          </a>
        }
      >
        There is no milestone at this address, or it is no longer shown.
      </EmptyState>
    </main>
  );
}
