-- 0169 — founder-executed actions (founder, Nov 22, 2026: "the agent never decides or calls submit and pay; the founder's
-- press does, so this is the founder filing, not agent code acting in their name"). One row per request an agent prepared
-- for the founder to press: the exact payload (the arguments the vendor tool will get), its hash, what the Needs you note
-- showed, and what became of the press. The gateway runs the vendor tool only from a fresh single-use token bound to
-- `payload_hash`, and only for a row still `prepared`.
--
-- Who may do what:
--   read    members of the business (the note shows the same text)
--   write   the services only (the gateway's prepare tool and its execute route)
--
-- `status`:
--   prepared   the note is open; nothing has been sent
--   executing  the founder pressed and the gateway claimed the row; exactly one press can claim it
--   executed   the vendor tool ran and answered (a mock answer is stored too, marked simulated in `result`)
--   failed     nothing went out (the vendor refused outright, or the gateway stopped before the call); never run again (a new note is the retry)
--   unknown    the vendor call may have run and nothing proves it did not (an error after the call, a record that could not be
--              written); never run again, and never reported as "nothing was sent"; the founder is told to check at the vendor
--   voided     what the note showed changed before the press, or the note was replaced; the token no longer works
--
-- `token_hash` is the sha256 of the press token's id, stored once the row is claimed: it is how a replay is recognized.
create table founder_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  connector_key text not null constraint founder_actions_connector_length check (char_length(connector_key) between 1 and 60),
  tool text not null constraint founder_actions_tool_length check (char_length(tool) between 1 and 120),
  -- The exact arguments of the vendor tool call.
  payload jsonb not null constraint founder_actions_payload_object check (jsonb_typeof(payload) = 'object'),
  -- sha256, lowercase hex, of the canonical JSON of `payload`.
  payload_hash text not null constraint founder_actions_payload_hash_hex check (payload_hash ~ '^[0-9a-f]{64}$'),
  -- What the note showed: `{ title, lines, facts }`; the gateway compares `facts` with a fresh read before it runs anything.
  summary jsonb not null constraint founder_actions_summary_object check (jsonb_typeof(summary) = 'object'),
  prepared_by_agent_id uuid,
  inbox_item_id uuid references inbox_items(id) on delete set null,
  status text not null default 'prepared'
    constraint founder_actions_status_value check (status in ('prepared','executing','executed','failed','unknown','voided')),
  token_hash text constraint founder_actions_token_hash_hex check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at timestamptz,
  pressed_by uuid,
  pressed_at timestamptz,
  executed_at timestamptz,
  result jsonb constraint founder_actions_result_object check (result is null or jsonb_typeof(result) = 'object'),
  error text constraint founder_actions_error_length check (error is null or char_length(error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_actions_claimed_has_press check (status = 'prepared' or status = 'voided' or (token_hash is not null and pressed_by is not null and pressed_at is not null))
);
--> statement-breakpoint
-- One open request per payload: preparing the same one again returns the open one.
create unique index founder_actions_open_key on founder_actions (business_id, connector_key, tool, payload_hash) where status = 'prepared';
--> statement-breakpoint
create index founder_actions_inbox_item_id_idx on founder_actions (inbox_item_id);
--> statement-breakpoint
select fm_tenant_table('founder_actions', array['owner'], 'read_only');
--> statement-breakpoint
revoke insert, update, delete on founder_actions from anon, authenticated;
