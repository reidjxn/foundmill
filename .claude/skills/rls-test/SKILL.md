---
name: rls-test
description: Write cross-tenant row-level security tests for a business-scoped table. Use in the same change that adds or alters a table with business_id.
argument-hint: "<table>"
---

# Cross-tenant RLS tests

1. Copy the pattern of a neighbor in `packages/db/src/__tests__/rls/`.
2. Two businesses, a member of each. Prove: a member reads and writes their own rows; the other business's member reads none, cannot insert with the first business's id, cannot update or delete its rows; an anonymous caller sees nothing (or only the public view, if the table has one).
3. Run `pnpm test:rls`. A new table without this test is not done.
