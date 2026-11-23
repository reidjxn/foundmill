"use client";
/** The "On {APP_NAME}" search over public profiles: the query, and the result list the CRM search and /network show. */
import { useQuery } from "@tanstack/react-query";
import { Building2, Globe, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { Chip, Icon } from "@foundmill/dugout";
import { publicHitDescription, publicProfileHref, publicSearchText, type PublicHit } from "@/lib/public-search";
import { useTRPC } from "@/lib/trpc-react";
import { AdultNotice, useCanReadPeople } from "./shared";

/** Public profiles matching `text` (two characters or more); empty while `enabled` is false or the text is short. */
export function usePublicSearch(text: string, enabled = true) {
  const trpc = useTRPC();
  const q = publicSearchText(text);
  // Searching for people waits for the 18+ confirmation; `needsAdult` says so, and the caller shows AdultNotice.
  const canRead = useCanReadPeople();
  const query = useQuery(trpc.live.people.search.queryOptions({ q: q ?? "--", limit: 8 }, { enabled: enabled && q !== null && canRead === true, staleTime: 15_000, retry: false, placeholderData: (previous) => previous }));
  return { hits: q === null || canRead !== true ? [] : (query.data?.hits ?? []), isLoading: q !== null && (canRead === null || query.isLoading), error: query.error, text: q, needsAdult: canRead === false };
}

/** Rows that open a profile page; every row is labeled "On {APP_NAME}". */
export function PublicHitList({ hits, "data-testid": testId }: { hits: readonly PublicHit[]; "data-testid"?: string }) {
  const router = useRouter();
  return (
    <ul data-testid={testId}>
      {hits.map((h) => (
        <li key={`${h.kind}:${h.kind === "founder" ? h.userId : h.businessId}`}>
          <button type="button" className="flex min-h-tap w-full items-center gap-2 px-3 py-1.5 text-left @page-wide:min-h-0 text-body text-primary hover:bg-white/4" onClick={() => router.push(publicProfileHref(h))} data-public-kind={h.kind}>
            <Icon icon={h.kind === "founder" ? User : Building2} size={16} className="text-secondary" />
            <span className="min-w-0 flex-1 truncate">{h.name}</span>
            <span className="text-small text-secondary">{publicHitDescription(h)}</span>
            <Chip tone="info">On {APP_NAME}</Chip>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The typeahead's "On {APP_NAME}" group (a LIVE business): public profiles that match the typed words, beneath the CRM's own records. */
export function OnNetworkResults({ text }: { text: string }) {
  const { hits, isLoading, error, text: q, needsAdult } = usePublicSearch(text);
  if (q === null) return null;
  if (needsAdult) {
    return (
      <section aria-label={`On ${APP_NAME}`} className="border-t border-subtle" data-testid="crm-on-network">
        <AdultNotice />
      </section>
    );
  }
  return (
    <section aria-label={`On ${APP_NAME}`} className="border-t border-subtle" data-testid="crm-on-network">
      <h3 className="t-label flex items-center gap-1 bg-panel-alt px-3 py-1">
        <Icon icon={Globe} size={12} /> On {APP_NAME} <span className="text-secondary">· {hits.length}</span>
      </h3>
      {isLoading && hits.length === 0 ? <p className="px-3 py-1.5 text-small text-secondary">Searching the network…</p> : null}
      {error ? <p className="px-3 py-1.5 text-small text-secondary">The network search is not available right now.</p> : null}
      {!isLoading && !error && hits.length === 0 ? <p className="px-3 py-1.5 text-small text-secondary">No public profile matches “{q}”.</p> : null}
      {hits.length > 0 ? <PublicHitList hits={hits.slice(0, 5)} /> : null}
    </section>
  );
}
