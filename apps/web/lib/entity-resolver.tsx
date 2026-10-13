"use client";
/**
 * The business shell's EntityLinkProvider value (audit GTM-19, VFR3-X1, GTM-26): every entity mention in the Inbox,
 * notes and module screens resolves to the right place and a full hover card, and offers its right-click verbs.
 *
 * - Agents come from the department lists the shell already holds (mentioned by agent id).
 * - CRM records are looked up in batches of up to 50 through `crm.entity.lookup` the first time a mention renders,
 *   then cached for the business; the provider value changes when a batch lands, so the mentions re-render with their
 *   kind, href and card. A member walled from the CRM asks for nothing (their mentions keep the name only).
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EntityLinkContextValue, EntityRef, EntityVerb } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { agentDetails, entityHref, recordDetails, type AgentSummary, type EntityLookupRow } from "./entity-links";
import { isGuid } from "./ids";
import { useTRPC } from "./trpc-react";

/** Largest batch `crm.entity.lookup` takes. */
export const LOOKUP_BATCH = 50;

export interface EntityResolverOptions {
  businessId: string;
  agents: readonly AgentSummary[];
  /** The member may read the CRM (records are looked up only then). */
  canReadCrm: boolean;
  navigate: (href: string) => void;
  /** "Message" on an agent opens its desk. */
  onMessageAgent?: (agent: AgentSummary) => void;
}

/** Where each right-click verb goes for a record (agents: Message opens the desk, Open profile the profile). */
export function verbHref(businessId: string, verb: EntityVerb, entityId: string): string {
  if (verb === "message") return routes.crm(businessId, entityId, "activity");
  if (verb === "assign_agent" || verb === "add_to_list") return `${routes.crm(businessId, entityId)}?role=1`;
  return routes.crm(businessId, entityId);
}

export function useEntityResolver({ businessId, agents, canReadCrm, navigate, onMessageAgent }: EntityResolverOptions): EntityLinkContextValue {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const cache = useRef(new Map<string, EntityLookupRow | null>());
  const pending = useRef(new Set<string>());
  const timer = useRef<number | null>(null);
  const [version, setVersion] = useState(0);

  // A new business starts with an empty cache.
  useEffect(() => {
    cache.current = new Map();
    pending.current.clear();
    setVersion((v) => v + 1);
  }, [businessId]);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const isAgentId = useCallback((id: string) => agentById.has(id), [agentById]);

  const flush = useCallback(async () => {
    timer.current = null;
    const ids = [...pending.current].slice(0, LOOKUP_BATCH);
    for (const id of ids) pending.current.delete(id);
    if (!ids.length) return;
    try {
      const rows = await queryClient.fetchQuery(trpc.crm.entity.lookup.queryOptions({ businessId, entityIds: ids }, { staleTime: 60_000 }));
      for (const id of ids) cache.current.set(id, null);
      for (const row of rows) cache.current.set(row.id, row);
    } catch {
      // Not readable (a wall, a blip): the mentions keep their names; nothing is asked again for these ids.
      for (const id of ids) cache.current.set(id, null);
    }
    setVersion((v) => v + 1);
    if (pending.current.size && timer.current === null) timer.current = window.setTimeout(() => void flush(), 0);
  }, [queryClient, trpc, businessId]);

  const request = useCallback(
    (id: string) => {
      if (!canReadCrm || !isGuid(id) || cache.current.has(id) || pending.current.has(id)) return;
      pending.current.add(id);
      if (timer.current === null && typeof window !== "undefined") timer.current = window.setTimeout(() => void flush(), 0);
    },
    [canReadCrm, flush],
  );

  return useMemo<EntityLinkContextValue>(() => {
    void version;
    const recordAgent = (id: string) => {
      const row = cache.current.get(id);
      return row?.agentId ? agentById.get(row.agentId) : undefined;
    };
    const hrefFor = (ref: { id: string; href?: string }) => ref.href ?? entityHref(businessId, { id: ref.id, agentId: cache.current.get(ref.id)?.agentId ?? null }, isAgentId);
    return {
      // Known not to be a record or an agent of this business (looked up and absent): no link (audit FR-23).
      exists: (id) => {
        if (agentById.has(id)) return true;
        const row = cache.current.get(id);
        return row === undefined ? undefined : row !== null;
      },
      resolve: (id) => {
        const agent = agentById.get(id);
        if (agent) return agentDetails(businessId, agent);
        const row = cache.current.get(id);
        if (row === undefined) {
          request(id);
          return undefined;
        }
        if (row === null) return undefined;
        const asAgent = recordAgent(id);
        return asAgent ? { ...agentDetails(businessId, asAgent), id: row.id } : recordDetails(businessId, row, isAgentId);
      },
      hrefFor,
      onOpen: (ref: EntityRef) => navigate(hrefFor(ref)),
      onVerb: (verb, ref) => {
        const agent = agentById.get(ref.id) ?? recordAgent(ref.id);
        if (agent) {
          if (verb === "message" && onMessageAgent) onMessageAgent(agent);
          else navigate(routes.agent(businessId, agent.id));
          return;
        }
        navigate(verbHref(businessId, verb, ref.id));
      },
    };
  }, [version, agentById, businessId, isAgentId, request, navigate, onMessageAgent]);
}
