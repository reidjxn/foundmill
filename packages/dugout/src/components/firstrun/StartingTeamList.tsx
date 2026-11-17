"use client";
/**
 * StartingTeamList: the team a new project is shown (WP-04 T4; founder decision 2: everyone is hired, three are shown).
 * The starting agents are listed; the rest wait behind "See everyone". Models are named only when `showModels` is on
 * (Builder view). Pure: the caller splits the team (`startingTeam` in @foundmill/shared) and passes the rows.
 */
import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { DeptColourToken } from "@foundmill/shared";
import { Avatar } from "../foundation/Avatar";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";

export interface StartingTeamAgent {
  /** The template key: the row's key and the avatar's seed. */
  key: string;
  name: string;
  role: string;
  dept: DeptColourToken;
  /** The model's plain name ("Opus"); shown only with `showModels`. */
  model?: ReactNode;
  /** Set on the row as `data-department`. */
  departmentSlug?: string | null;
}

export interface StartingTeamListProps {
  starting: readonly StartingTeamAgent[];
  later: readonly StartingTeamAgent[];
  /** Builder view: a chip with each agent's model. */
  showModels?: boolean;
  /** The list's accessible name. */
  label?: string;
}

export const STARTING_TEAM_WORDS = { seeEveryone: "See everyone" } as const;

export function StartingTeamList({ starting, later, showModels = false, label = "Team" }: StartingTeamListProps) {
  const [everyone, setEveryone] = useState(false);
  const listId = useId();
  const rows = everyone ? [...starting, ...later] : starting;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-line-faint" aria-label={label} id={listId}>
        {rows.map((a) => (
          <li key={a.key} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0" data-department={a.departmentSlug ?? undefined} data-agent={a.key}>
            <Avatar size={24} name={a.name} agent={{ seed: a.key, dept: a.dept }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-body-strong">{a.name}</div>
              <div className="truncate text-small text-secondary">{a.role}</div>
            </div>
            {showModels && a.model ? <Chip>{a.model}</Chip> : null}
          </li>
        ))}
      </ul>
      {later.length ? (
        <div className="flex">
          <Button type="button" variant="ghost" size="sm" icon={everyone ? ChevronUp : ChevronDown} aria-expanded={everyone} aria-controls={listId} onClick={() => setEveryone(!everyone)} className="min-h-tap" data-testid="see-everyone">
            {STARTING_TEAM_WORDS.seeEveryone}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
