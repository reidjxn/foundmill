"use client";
/**
 * Find people (docs/NETWORK.md F16, browse): everyone who published a page at /u/<handle>, newest first, narrowed by
 * words, what they are good at and what they are here for. Work first, face second: each row leads with the headline
 * and "Good at", and the picture is small. A row opens the person on the network (connect, message, report).
 *
 * The solo guard (NETWORK §10): the panel is the same for everyone, never badged and never counted; the order is the
 * publish date alone, and "Building on my own" is never written on a row (the page itself says nothing about people
 * for that answer). Works from 390 px.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import {
  Avatar,
  Button,
  Chip,
  Input,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@foundmill/dugout";
import { lookingForLine, type PersonLookingFor } from "@foundmill/shared/person-profile";
import { errorMessage, type RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

type Person = RouterOutputs["live"]["people"]["find"]["items"][number];

/** "Here for": anyone, or the people who said they want company. */
const HERE_FOR: readonly { value: string; label: string; lookingFor?: PersonLookingFor[] }[] = [
  { value: "anyone", label: "Anyone" },
  {
    value: "people",
    label: "Open to building with people",
    lookingFor: ["open_to_people", "looking_for_cofounder", "looking_to_join"],
  },
  { value: "cofounder", label: "Looking for a cofounder", lookingFor: ["looking_for_cofounder"] },
  { value: "join", label: "Looking to join a project", lookingFor: ["looking_to_join"] },
];

const PAGE = 12;

export function FindPeoplePanel({ className }: { className?: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [goodAt, setGoodAt] = useState("");
  const [hereFor, setHereFor] = useState("anyone");
  const filter = {
    q: useDeferredValue(q.trim()) || undefined,
    goodAt: useDeferredValue(goodAt.trim()) || undefined,
    lookingFor: HERE_FOR.find((h) => h.value === hereFor)?.lookingFor,
    limit: PAGE,
  };
  const query = useInfiniteQuery(
    trpc.live.people.find.infiniteQueryOptions(filter, {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      initialCursor: null,
      staleTime: 15_000,
      retry: false,
      placeholderData: (previous) => previous,
    }),
  );
  const people = (query.data?.pages ?? []).flatMap((p) => p.items);
  const narrowed = Boolean(filter.q || filter.goodAt || filter.lookingFor);

  return (
    <Panel
      title="Find people"
      className={className}
      footer="Everyone here published a page at their own address. Newest first."
      flush
      error={query.error ? errorMessage(query.error) : undefined}
      onRetry={() => void query.refetch()}
      data-testid="find-people"
    >
      <div className="grid grid-cols-1 gap-3 p-panel-pad @page-wide:grid-cols-3">
        <Input
          wrapperClassName="min-h-tap @page-wide:min-h-0"
          icon={Search}
          aria-label="Search people"
          placeholder="A name, a place, a skill"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={120}
          data-testid="find-people-q"
        />
        <Input
          wrapperClassName="min-h-tap @page-wide:min-h-0"
          aria-label="Good at"
          placeholder="Good at, like design or sales"
          value={goodAt}
          onChange={(e) => setGoodAt(e.target.value)}
          maxLength={60}
          data-testid="find-people-good-at"
        />
        <Select value={hereFor} onValueChange={setHereFor}>
          <SelectTrigger
            id="find-people-here-for"
            aria-label="Here for"
            className="min-h-tap @page-wide:min-h-0"
            data-testid="find-people-here-for"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HERE_FOR.map((h) => (
              <SelectItem key={h.value} value={h.value}>
                {h.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {query.isLoading ? (
        <p className="px-panel-pad pb-3 text-small text-secondary">Looking…</p>
      ) : people.length === 0 && !query.error ? (
        <p
          className="flex items-center gap-2 px-panel-pad pb-3 text-small text-secondary"
          data-testid="find-people-empty"
        >
          <UsersRound aria-hidden className="size-icon-inline" />
          {narrowed
            ? "Nobody matches yet. Try other words."
            : "Nobody has published a page yet. Yours can be the first, from Your public page."}
        </p>
      ) : (
        <ul data-testid="find-people-results">
          {people.map((p) => (
            <PersonRow
              key={p.userId}
              person={p}
              onOpen={() => router.push(`/profiles/founder/${p.userId}`)}
            />
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <div className="px-panel-pad pb-3">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-tap @page-wide:min-h-0"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
            data-testid="find-people-more"
          >
            Show more
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

function PersonRow({ person, onOpen }: { person: Person; onOpen: () => void }) {
  const line = lookingForLine(person.lookingFor);
  return (
    <li className="border-t border-subtle/50">
      <button
        type="button"
        className="flex min-h-tap w-full items-start gap-3 px-panel-pad py-2.5 text-left hover:bg-white/4"
        onClick={onOpen}
        data-person-handle={person.handle}
        data-testid="find-people-row"
      >
        <Avatar size={24} name={person.name} className="mt-0.5 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-body-strong text-primary">{person.headline || person.name}</span>
          <span className="text-small text-secondary">
            {person.headline ? person.name : null}
            {person.headline && person.place ? " · " : null}
            {person.place}
          </span>
          {person.strengths.length ? (
            <span className="flex flex-wrap gap-1" aria-label="Good at">
              {person.strengths.slice(0, 5).map((s) => (
                <Chip key={s} tone="neutral">
                  {s}
                </Chip>
              ))}
            </span>
          ) : null}
          {line ? <span className="text-small text-secondary">{line}</span> : null}
        </span>
      </button>
    </li>
  );
}
