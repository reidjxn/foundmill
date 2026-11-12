-- 0084 — Team call (docs/TEAM_CALL.md §2, founder Nov 12, 2026): a spoken call between the founder and their team of
-- agents (`team`) or one agent (`one_to_one`), its turns in speaking order, and the action items filed when it ends;
-- `plans.origin` gains `team_call`; `agents.speech_accent` keeps the founder's own choice of how an agent sounds.
--
-- Access is the agent desk's (0020 `agent_threads` / `agent_messages`, `fm_tenant_table`): members read; owners,
-- admins and members write; viewers, example viewers (always viewers, 0065) and advisors read only. The Team section
-- wall is the api's (`businessProcedure` with Team read / Team write), as it is for the desk; nothing in SQL is gated
-- by section. Turns and action items are insert-only for app roles (no update or delete grant); only `team_calls`
-- changes after insert, and an app role may change only its status, summary, counters, `ended_at` and `updated_at`
-- (column grants). No app role deletes a call: it goes with its business.
create table team_calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  kind text not null constraint team_calls_kind_known check (kind in ('team','one_to_one')),
  status text not null default 'live' constraint team_calls_status_known check (status in ('live','wrapping_up','ended')),
  topic text constraint team_calls_topic_size check (topic is null or char_length(topic) between 1 and 200),
  -- The agents on the call (no FK on an array: the api and `repos.teamCalls.create` check each is the business's).
  agent_ids uuid[] not null,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  summary text constraint team_calls_summary_size check (summary is null or char_length(summary) <= 4000),
  agent_rounds_since_founder int not null default 0 constraint team_calls_agent_rounds_nonneg check (agent_rounds_since_founder >= 0),
  turn_count int not null default 0 constraint team_calls_turn_count_nonneg check (turn_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_calls_id_business_id_key unique (id, business_id),
  constraint team_calls_agents_size check (cardinality(agent_ids) between 1 and 8 and array_position(agent_ids, null) is null),
  constraint team_calls_one_to_one_single check (kind <> 'one_to_one' or cardinality(agent_ids) = 1),
  -- An ended call has its end time; a live or wrapping-up one has none (reopening after a failed wrap-up keeps it null).
  constraint team_calls_ended_dated check ((status = 'ended') = (ended_at is not null))
);
--> statement-breakpoint
create index team_calls_business_started_idx on team_calls (business_id, started_at desc);
--> statement-breakpoint
create index team_calls_started_by_idx on team_calls (started_by);
--> statement-breakpoint
select fm_tenant_table('team_calls');
--> statement-breakpoint
revoke update, delete on team_calls from authenticated;
--> statement-breakpoint
grant update (status, summary, agent_rounds_since_founder, turn_count, ended_at, updated_at) on team_calls to authenticated;
--> statement-breakpoint
create table team_call_turns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  call_id uuid not null,
  seq int not null constraint team_call_turns_seq_positive check (seq >= 1),
  speaker text not null constraint team_call_turns_speaker_known check (speaker in ('founder','agent')),
  agent_id uuid references agents(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  text text not null constraint team_call_turns_text_size check (char_length(text) between 1 and 2000),
  -- "founder", "team" or {"agentId": "<uuid>"}; null when not said.
  addressed_to jsonb constraint team_call_turns_addressed_to_shape check (
    addressed_to is null
    or addressed_to in ('"founder"'::jsonb, '"team"'::jsonb)
    or (
      jsonb_typeof(addressed_to) = 'object'
      and addressed_to - 'agentId' = '{}'::jsonb
      and jsonb_typeof(addressed_to -> 'agentId') = 'string'
      and (addressed_to ->> 'agentId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
  ),
  via text constraint team_call_turns_via_known check (via in ('spoken','typed')),
  client_turn_id text constraint team_call_turns_client_turn_id_size check (client_turn_id is null or char_length(client_turn_id) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_call_turns_call_fkey foreign key (call_id, business_id) references team_calls(id, business_id) on delete cascade,
  constraint team_call_turns_seq_key unique (call_id, seq),
  -- Shapes that survive a deleted agent or account (`on delete set null`): an agent turn never names a person or how it
  -- arrived, a founder turn never names an agent. That a new turn names its speaker is checked on insert (trigger below).
  constraint team_call_turns_agent_shape check (speaker = 'founder' or (user_id is null and via is null)),
  constraint team_call_turns_founder_shape check (speaker = 'agent' or agent_id is null)
);
--> statement-breakpoint
-- A retried send is idempotent: one turn per client id per call.
create unique index team_call_turns_client_turn_idx on team_call_turns (call_id, client_turn_id) where client_turn_id is not null;
--> statement-breakpoint
create index team_call_turns_business_id_idx on team_call_turns (business_id, created_at desc);
--> statement-breakpoint
create index team_call_turns_agent_id_idx on team_call_turns (agent_id);
--> statement-breakpoint
create index team_call_turns_user_id_idx on team_call_turns (user_id);
--> statement-breakpoint
-- An agent turn has its agent and a founder turn its person when written. A check constraint would also refuse the
-- `set null` that deleting the agent or the account performs, and so block that delete (and possibly a business's own
-- delete, if its cascade to agents runs before its cascade to the turns); this runs on insert only.
create function fm_team_call_turns_speaker() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.speaker = 'agent' and new.agent_id is null then
    raise exception 'an agent turn names the agent who spoke' using errcode = '23514', constraint = 'team_call_turns_speaker_named';
  end if;
  if new.speaker = 'founder' and new.user_id is null then
    raise exception 'a founder turn names the person who spoke' using errcode = '23514', constraint = 'team_call_turns_speaker_named';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger team_call_turns_speaker before insert on team_call_turns for each row execute function fm_team_call_turns_speaker();
--> statement-breakpoint
select fm_tenant_table('team_call_turns', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create policy team_call_turns_insert on team_call_turns for insert with check (has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
revoke update, delete on team_call_turns from authenticated;
--> statement-breakpoint
create table team_call_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  call_id uuid not null,
  position int not null constraint team_call_actions_position_nonneg check (position >= 0),
  -- PLAN_ACTION_TYPES (packages/shared constants.ts), as plan_actions.type (0005).
  action_type text not null constraint team_call_actions_action_type_known check (action_type in (
    'create_task','enable_channel','disable_channel','set_budget','approve_spend','update_spec','update_roadmap',
    'send_message','schedule_meeting','hire_agent','train_agent','set_agent_model','create_playbook','request_human_action','reply_only'
  )),
  title text not null constraint team_call_actions_title_size check (char_length(title) between 1 and 200),
  detail text constraint team_call_actions_detail_size check (detail is null or char_length(detail) <= 1000),
  department_id uuid references departments(id) on delete set null,
  agent_id uuid references agents(id) on delete set null,
  status text not null constraint team_call_actions_status_known check (status in ('filed','awaiting_go_ahead','founder_step','not_filed')),
  target_kind text constraint team_call_actions_target_kind_known check (target_kind in ('task','roadmap_item','plan')),
  -- The created task, roadmap item or plan (no FK: it points at one of three tables, as agent_threads.subject_id does).
  target_id uuid,
  plan_id uuid references plans(id) on delete set null,
  plan_action_id uuid references plan_actions(id) on delete set null,
  reason text constraint team_call_actions_reason_size check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_call_actions_call_fkey foreign key (call_id, business_id) references team_calls(id, business_id) on delete cascade,
  constraint team_call_actions_position_key unique (call_id, position),
  constraint team_call_actions_target_pair check ((target_kind is null) = (target_id is null))
);
--> statement-breakpoint
create index team_call_actions_business_id_idx on team_call_actions (business_id, status);
--> statement-breakpoint
create index team_call_actions_department_id_idx on team_call_actions (department_id);
--> statement-breakpoint
create index team_call_actions_agent_id_idx on team_call_actions (agent_id);
--> statement-breakpoint
create index team_call_actions_plan_id_idx on team_call_actions (plan_id);
--> statement-breakpoint
create index team_call_actions_plan_action_id_idx on team_call_actions (plan_action_id);
--> statement-breakpoint
select fm_tenant_table('team_call_actions', array['owner','admin','member'], 'read_only');
--> statement-breakpoint
create policy team_call_actions_insert on team_call_actions for insert with check (has_role(business_id, array['owner','admin','member']));
--> statement-breakpoint
revoke update, delete on team_call_actions from authenticated;
--> statement-breakpoint
-- A call's agreed steps run as a plan of their own origin (PLAN_ORIGINS already has `team_call`). Widened, never narrowed.
alter table plans drop constraint plans_origin_check;
--> statement-breakpoint
alter table plans add constraint plans_origin_check check (origin in ('option','free_text','playbook','holiday','team_call'));
--> statement-breakpoint
-- How an agent sounds on a call (founder, Nov 12, 2026: "the founder can change it per agent"). Null = the derived
-- default (packages/shared `defaultSpeechAccents`, computed on every read, never stored); a value is the founder's own
-- choice, a `SPEECH_ACCENTS` key. The api checks the key is known; the database checks only its shape.
alter table agents add column speech_accent text constraint agents_speech_accent_shape check (speech_accent is null or speech_accent ~ '^[a-z]{2,20}$');
--> statement-breakpoint
-- The agents write policy (0004, `fm_tenant_table`) lets owners, admins and members write every column; choosing how an
-- agent sounds is an owner's or an admin's (like the department settings), so an app role that sets or changes it is
-- refused here unless it is one. Every other column keeps the 0004 policy unchanged. Not security definer:
-- `current_user` must be the caller's role (service code is not an app role and passes).
create function fm_agents_speech_accent_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and new.speech_accent is not null) or (tg_op = 'UPDATE' and new.speech_accent is distinct from old.speech_accent))
     and not has_role(new.business_id, array['owner','admin']) then
    raise exception 'permission denied: only an owner or an admin chooses how an agent sounds' using errcode = '42501';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger agents_speech_accent_guard before insert or update of speech_accent on agents for each row execute function fm_agents_speech_accent_guard();
--> statement-breakpoint
-- Defense in depth for a client that writes these tables directly (security review, Nov 12, 2026): an app role starts
-- a call only as itself, live, with fresh counters and agents of the business, and speaks only as itself. The api
-- writes the same values; service code is not an app role and passes. Not security definer, so `current_user` is the
-- caller's role.
create function fm_team_calls_insert_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.started_by is distinct from auth.uid() or new.status <> 'live' or new.turn_count <> 0 or new.agent_rounds_since_founder <> 0
       or new.summary is not null or new.ended_at is not null then
      raise exception 'permission denied: a call starts live, as the person starting it' using errcode = '42501';
    end if;
    if exists (select 1 from unnest(new.agent_ids) as a(id) where not exists (select 1 from agents g where g.id = a.id and g.business_id = new.business_id)) then
      raise exception 'permission denied: every agent on a call is one of the business''s agents' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger team_calls_insert_guard before insert on team_calls for each row execute function fm_team_calls_insert_guard();
--> statement-breakpoint
create function fm_team_call_turns_own_words() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and new.speaker = 'founder' and new.user_id is distinct from auth.uid() then
    raise exception 'permission denied: a person speaks on a call only as themselves' using errcode = '42501';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger team_call_turns_own_words before insert on team_call_turns for each row execute function fm_team_call_turns_own_words();
