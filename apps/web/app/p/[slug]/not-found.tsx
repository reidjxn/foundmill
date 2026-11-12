/**
 * No public page at this address (never published, taken down, or never existed: the same answer for each, so nothing
 * leaks about a project that is not public). Signed out and from 390 px like the page itself, so a phone is never left
 * at a dead end: the one way on is the site's home.
 */
import { SearchX } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { EmptyState } from "@foundmill/dugout";

export default function PublicPageNotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-gutter" data-testid="public-page-not-found">
      <EmptyState
        icon={SearchX}
        title="No public page here"
        actions={
          <a href="/" className="btn-secondary t-action inline-flex min-h-tap items-center rounded-sm px-btn-md text-primary focus-ring">
            {`Go to ${APP_NAME}`}
          </a>
        }
      >
        There is no public page at this address, or it was taken down.
      </EmptyState>
    </main>
  );
}
