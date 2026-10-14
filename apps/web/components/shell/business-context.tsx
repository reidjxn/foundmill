"use client";
/**
 * Business context for every page under /b/[bid]: the business row, the founder's role, departments (in order) and
 * helpers to resolve a department by slug. The layout seeds it from the server; the shell keeps it fresh.
 */
import { createContext, useContext, type ReactNode } from "react";
import { accessFor, type Access } from "@/lib/access";
import type { RouterOutputs } from "@/lib/trpc";

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

/**
 * The business's currency: the one its money is kept in (`businesses.currency`, 0025: chosen at commit, changed in
 * Settings › Business), on the business row the layout already holds, so it costs no request and is there for every
 * member whatever their section access. Screens use it for every business amount they format, never a hard-coded code,
 * a bank account's currency or a glossary entry. Model and credit costs are not business money: they read in USD.
 */
export function useBusinessCurrency(): string {
  return useBusiness().data.business.currency;
}
