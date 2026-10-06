/** FK helpers to businesses. Kept out of the schema namespace (index.ts) so only tables/views are exported. */
import { uuid } from "drizzle-orm/pg-core";
import { businesses } from "./accounts";

/** `business_id uuid not null references businesses(id) on delete cascade` — every business-scoped table. */
export const businessId = () => uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" });
/** Nullable variant (ideas until commit, platform-wide skill definitions, platform suppression scope). */
export const businessIdNullable = () => uuid("business_id").references(() => businesses.id, { onDelete: "cascade" });
