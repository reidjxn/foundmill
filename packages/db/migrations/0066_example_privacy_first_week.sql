-- 0066 — example viewers do not see one another, and the first-week checklist's founder-message check has an index.
--
-- memberships_select (0001) let any member read every membership row of the business. With example memberships (0065)
-- that meant every example viewer of the shared demo could read every other example viewer's row, i.e. the user ids
-- of unrelated founders, under the authenticated role. The repos already left example rows out of every list; the
-- policy now does too: an example row is visible to the person it belongs to and to nobody else under RLS (staff never
-- list example viewers either). Every other row reads as before. The service connection (business.example.*) is
-- unaffected, and is_member/has_role are security definer, so access checks never depended on this policy.
drop policy memberships_select on memberships;
--> statement-breakpoint
create policy memberships_select on memberships for select using (is_member(business_id) and (source <> 'example' or user_id = auth.uid()));
--> statement-breakpoint
-- business.firstWeek.get asks "has the founder written to any agent?" (conversations.anyFounderMessage). Without this
-- index the check scanned every message of the business exactly when there is none, a new founder's case.
create index agent_messages_business_author_kind_idx on agent_messages (business_id, author_kind);
