-- 0135 — payment powers (founder, Nov 16, 2026). What the founder lets agents do with money without asking in automated
-- mode and while on vacation. Only 'inbound' exists: agents may create invoices and payment pages. Empty (the default):
-- such a call waits in Needs you in every mode. There is no outbound power: CLAUDE.md's Never list says agent code never
-- moves money, and paying out, refunding and transferring stay hard gates. A later value would widen the check, nothing
-- else. Written by owners and admins under the existing businesses_update policy (has_role owner, admin).
alter table businesses add column payment_powers text[] not null default '{}';
--> statement-breakpoint
alter table businesses add constraint businesses_payment_powers_known check (payment_powers <@ array['inbound']::text[]);
