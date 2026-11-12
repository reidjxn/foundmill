"use client";
import type { HTMLAttributes } from "react";
import { TEAM_CALL_LIMITS } from "@foundmill/shared/team-call";
import { cn } from "../../lib/cn";
import { Avatar } from "../foundation/Avatar";
import { Checkbox } from "../foundation/Checkbox";
import { AiAgentTag } from "../conversation/DeskPresence";
import { participantIdentity, useCallAgentDisplay, type CallAgentInput } from "./identity";

/** An agent who could join a team call: a participant without its accent. */
export type CallPickerAgent = CallAgentInput;

export interface CallLobbyPickerProps extends Omit<HTMLAttributes<HTMLFieldSetElement>, "onChange" | "children"> {
  agents: readonly CallPickerAgent[];
  /** Selected agent ids (controlled). */
  selected: readonly string[];
  onChange: (agentIds: string[]) => void;
  /** Most agents on a call. Default `TEAM_CALL_LIMITS.maxAgentsInTeamCall`. */
  max?: number;
  disabled?: boolean;
}

/** The Chief of Staff first; the rest keep the order given. */
export function chiefOfStaffFirst<T extends { isChiefOfStaff: boolean }>(agents: readonly T[]): T[] {
  return [...agents.filter((a) => a.isChiefOfStaff), ...agents.filter((a) => !a.isChiefOfStaff)];
}

/**
 * Choose who is on a team call: a checklist of agent rows (portrait, `nameFor`, `positionFor`, the "AI agent" marker),
 * the Chief of Staff first, at most `max` ticked; once the limit is reached the unticked rows wait, and say why. Each row
 * is one target; Space ticks it.
 */
export function CallLobbyPicker({ agents, selected, onChange, max = TEAM_CALL_LIMITS.maxAgentsInTeamCall, disabled = false, className, ...rest }: CallLobbyPickerProps) {
  const display = useCallAgentDisplay();
  const chosen = new Set(selected);
  const full = chosen.size >= max;
  const toggle = (id: string, on: boolean) => {
    if (on && full) return;
    const next = on ? [...selected, id] : selected.filter((s) => s !== id);
    onChange(chiefOfStaffFirst(agents).filter((a) => next.includes(a.agentId)).map((a) => a.agentId));
  };
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-1", className)} disabled={disabled} data-testid="call-lobby-picker" {...rest}>
      <legend className="flex w-full items-baseline justify-between gap-2 pb-1">
        <span className="t-label">Who is on the call</span>
        <span className="font-mono text-micro tabular text-tertiary" data-testid="call-lobby-count">
          {chosen.size} of {max}
        </span>
      </legend>
      <ul className="flex flex-col">
        {chiefOfStaffFirst(agents).map((a) => {
          const d = display(a);
          const on = chosen.has(a.agentId);
          const waits = !on && full;
          const id = `call-pick-${a.agentId}`;
          return (
            <li key={a.agentId}>
              <label
                htmlFor={id}
                className={cn(
                  "flex min-h-row-comfortable cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 transition-colors hover:bg-white/4",
                  (waits || disabled) && "cursor-not-allowed opacity-60 hover:bg-transparent",
                )}
                data-testid="call-lobby-row"
                data-selected={on || undefined}
              >
                <Checkbox id={id} checked={on} disabled={disabled || waits} onCheckedChange={(v) => toggle(a.agentId, v === true)} />
                <Avatar
                  size={28}
                  name={d.name}
                  agent={{ seed: a.avatarSeed, dept: d.dept ?? "dept-1", personaKey: participantIdentity(a).personaKey, layer: a.layer, src: d.portrait }}
                />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate text-body font-medium text-primary" data-testid="call-lobby-name">
                    {d.name}
                  </span>
                  {d.position ? (
                    <span className="truncate text-small text-secondary" data-testid="call-lobby-role">
                      {d.position}
                    </span>
                  ) : null}
                </span>
                <AiAgentTag />
              </label>
            </li>
          );
        })}
      </ul>
      {full ? (
        <p className="px-2 pt-1 text-small text-tertiary" role="status">
          A call holds {max} agents. Untick one to add another.
        </p>
      ) : null}
    </fieldset>
  );
}
