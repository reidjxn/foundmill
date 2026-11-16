-- 0125 — a reply's own words, kept so the founders can read and answer it (WP-08 T2; audit a5 GTM-04; founder D3,
-- Nov 16, 2026). Ingest writes one `interactions` row per verified reply that reaches the project's Foundmill address,
-- with the id the `lead.replied` event already names (`interactionId`). The text is stored as plain text, at most
-- 20,000 characters, written by a stranger: it is shown as plain text only and no agent tool returns it (the subject is
-- on `summary`, which agents read only as untrusted content). It is
-- not encrypted (the alternative was an encrypted body store first, about a week, Estimate); it is deleted with the
-- person's record (`repos.entities.purge` deletes their interactions).
--
-- RLS unchanged: interactions keeps its tenant policy (0008). The api serves the column only through `crm.*`
-- procedures, which need access to Customers.
alter table interactions add column body_untrusted text;
--> statement-breakpoint
alter table interactions add constraint interactions_body_untrusted_length check (body_untrusted is null or char_length(body_untrusted) <= 20000);
