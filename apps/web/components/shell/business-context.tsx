"use client";
/**
 * Business context for every page under /b/[bid]: the business row, the founder's role, departments (in order) and
 * helpers to resolve a department by slug. The layout seeds it from the server; the shell keeps it fresh.
 */
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { accessFor, type Access } from "@/lib/access";
import type { RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc-react";

export type BusinessGet = RouterOutputs["business"]["get"];
export type DepartmentList = RouterOutputs["department"]["list"];
export type DepartmentRow = DepartmentList[number];

export interface BusinessContextValue {
  businessId: string;
  data: BusinessGet;
  departments: DepartmentList;
  departmentBySlug: (slug: string) => DepartmentRow | undefined;
  departmentById: (id: string) => DepartmentRow | undefined;
  /** Role-based gate used by settings (owner/admin). */
  isAdmin: boolean;
  isOwner: boolean;
  /** The person's role and section permissions: what to show, and what they may change (lib/access.ts). */
  access: Access;
}

const Ctx = createContext<BusinessContextValue | null>(null);

export function BusinessProvider({ value, children }: { value: BusinessContextValue; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBusiness(): BusinessContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBusiness must be used inside the /b/[bid] layout");
  return v;
}

export function makeBusinessContext(businessId: string, data: BusinessGet, departments: DepartmentList): BusinessContextValue {
  return {
    businessId,
    data,
    departments,
    departmentBySlug: (slug) => departments.find((d) => d.slug === slug),
    departmentById: (id) => departments.find((d) => d.id === id),
    isAdmin: data.role === "owner" || data.role === "admin",
    isOwner: data.role === "owner",
    access: accessFor(data.membership),
  };
}

/** Before finance has answered, and for a business with no money yet: the shell's own fallback. */
export const FALLBACK_CURRENCY = "EUR";

/**
 * The business's currency: the one its money is kept in (finance.overview's cash currency), read from the query the
 * shell already runs for the top bar, so it costs no request. Screens use it for every amount they format, never a
 * hard-coded code or a glossary entry.
 */
export function useBusinessCurrency(): string {
  const { businessId } = useBusiness();
  const trpc = useTRPC();
  const finance = useQuery(trpc.finance.overview.queryOptions({ businessId }, { staleTime: 60_000, retry: false }));
  return finance.data?.cash.currency ?? FALLBACK_CURRENCY;
}
