"use client";
/**
 * The browser title inside a business ("Inbox · Northwind Skincare · Foundmill", lib/page-titles.ts), rendered from what
 * the shell already holds: the business, its departments and the path. React hoists the `<title>` into the document
 * head, server render included, and it follows renames and navigations with no request of its own. A CRM record's
 * name comes from the record query its screen runs (read from the cache, never fetched from here).
 */
import { skipToken, useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@foundmill/config";
import { businessDocumentTitle, businessScreenTitle, entityIdOfPath } from "@/lib/page-titles";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness } from "./business-context";

export function BusinessTitle() {
  const trpc = useTRPC();
  const { businessId, data, departments } = useBusiness();
  const pathname = usePathname() ?? "";
  const entityId = entityIdOfPath(pathname, businessId);
  const entity = useQuery({ ...trpc.crm.entity.get.queryOptions(entityId ? { businessId, entityId } : skipToken), enabled: false });
  const screen = businessScreenTitle(pathname, businessId, departments, entity.data?.entity.displayName ?? null);
  return <title>{businessDocumentTitle(screen, data.business.name, APP_NAME)}</title>;
}
