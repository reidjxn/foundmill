/**
 * Drizzle schema mirroring packages/db/migrations (the SQL is the source of truth; RLS lives there).
 * One file per migration group. Every table exports its inferred Select/Insert types.
 */
export * from "./tenancy";
export * from "./accounts";
export * from "./product";
export * from "./agents";
export * from "./inbox";
export * from "./distribution";
export * from "./journey";
export * from "./crm";
export * from "./finance";
export * from "./legal";
export * from "./governance";
export * from "./social";
export * from "./workspaces";
export * from "./brand";
export * from "./foundations";
export * from "./research";
export * from "./conversations";
export * from "./payments";
export * from "./table-views";
export * from "./personas";
export * from "./goals";
export * from "./pages";
export * from "./mail";
export * from "./demo";
