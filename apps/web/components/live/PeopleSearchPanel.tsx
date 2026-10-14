"use client";
/** /network: find founders and businesses on the network by name (public profiles only); a result opens its profile page. */
import { Search } from "lucide-react";
import { useState } from "react";
import { APP_NAME } from "@foundmill/config";
import { Input, Panel } from "@foundmill/dugout";
import { PUBLIC_SEARCH_MIN } from "@/lib/public-search";
import { errorMessage } from "@/lib/trpc";
import { PublicHitList, usePublicSearch } from "./public-search";

export function PeopleSearchPanel({ className }: { className?: string }) {
  const [text, setText] = useState("");
  const { hits, isLoading, error, text: q } = usePublicSearch(text);
  return (
    <Panel title={`Find on ${APP_NAME}`} className={className} footer="Searches live businesses and founders who made their name public." flush data-testid="people-search">
      <div className="p-panel-pad">
        <Input icon={Search} aria-label={`Search ${APP_NAME} by name`} placeholder="A founder or a business" value={text} onChange={(e) => setText(e.target.value)} maxLength={120} data-testid="people-search-input" />
      </div>
      {q === null ? (
        <p className="px-panel-pad pb-3 text-small text-secondary">Type at least {PUBLIC_SEARCH_MIN} letters of a name.</p>
      ) : error ? (
        <p className="px-panel-pad pb-3 text-small text-secondary" role="alert">
          {errorMessage(error)}
        </p>
      ) : isLoading && hits.length === 0 ? (
        <p className="px-panel-pad pb-3 text-small text-secondary">Searching…</p>
      ) : hits.length === 0 ? (
        <p className="px-panel-pad pb-3 text-small text-secondary" data-testid="people-search-empty">
          No public profile matches “{q}”.
        </p>
      ) : (
        <PublicHitList hits={hits} data-testid="people-search-results" />
      )}
    </Panel>
  );
}
