"use client";
/**
 * The browser title inside a business ("Inbox · Northwind Skincare · Foundmill", lib/page-titles.ts), rendered from what
 * the shell already holds: the business, its departments and the path. React hoists the `<title>` into the document
 * head, and it follows renames and navigations with no request of its own. A CRM record's name comes from the record
 * query its screen runs (read from the cache, never fetched from here).
 *
 * The server streams this title into the body (the layout finishes after the document head has gone out, see
 * app/b/loading.tsx). React takes that element over only when it is the document's first `title` element; when an
 * icon's SVG `<title>` comes first, React puts its own in the head and leaves the server's copy behind, so the copy is
 * removed once the title has mounted: the document keeps exactly one.
 */
import { skipToken, useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
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
  const ref = useRef<HTMLTitleElement>(null);
  useLayoutEffect(() => {
    for (const copy of document.querySelectorAll("body > title")) if (copy !== ref.current) copy.remove();
  }, []);
  return <title ref={ref}>{businessDocumentTitle(screen, data.business.name, APP_NAME)}</title>;
}
