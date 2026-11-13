-- 0100 — who funds a business's agent work (founder, Nov 13, 2026: "use your own AI plan" only through a provider's
-- official program; the seam is provider-neutral and off by default).
--
-- `funding_source`: `foundmill_credits` (the platform's key, paid from the month's credits), `own_api_key` (the
-- founder's own Anthropic key: `model_billing = 'byok'`) or `own_plan` (the founder's own AI plan at a provider, with
-- `funding_plan_provider` naming it). Nothing sets `own_plan` today: it sits behind `FLAGS.ownPlanFunding` (off) and no
-- provider is integrated (packages/config `OWN_PLAN_PROVIDERS` is empty).
--
-- The first two are not chosen here: they follow `model_billing`, kept in step by the trigger below on every write, so
-- the existing own-key path (`credits_or_byok`: storing a key flips `model_billing` to `byok`, revoking it flips it back)
-- maps onto `own_api_key` without any code change. `own_plan` is the only value written directly, and only by service
-- code (an app role that sets or changes it is refused, whatever its role).
alter table businesses add column funding_source text not null default 'foundmill_credits' constraint businesses_funding_source_check check (funding_source in ('foundmill_credits', 'own_api_key', 'own_plan'));
--> statement-breakpoint
alter table businesses add column funding_plan_provider text constraint businesses_funding_plan_provider_shape check (funding_plan_provider is null or funding_plan_provider ~ '^[a-z][a-z0-9_]{1,31}$');
--> statement-breakpoint
alter table businesses add constraint businesses_funding_plan_check check ((funding_source = 'own_plan') = (funding_plan_provider is not null));
--> statement-breakpoint
update businesses set funding_source = 'own_api_key' where model_billing = 'byok';
--> statement-breakpoint
-- Keeps `funding_source` in step with `model_billing` unless the business is on its own plan, and refuses an app role
-- (`authenticated`, `anon`) that sets or changes the plan. Not security definer: `current_user` must be the caller's
-- role (service code is not an app role and passes).
create function fm_businesses_funding_source() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and (new.funding_source = 'own_plan' or new.funding_plan_provider is not null))
       or (tg_op = 'UPDATE' and (new.funding_plan_provider is distinct from old.funding_plan_provider
                                 or (new.funding_source = 'own_plan') is distinct from (old.funding_source = 'own_plan')))) then
    raise exception 'permission denied: only service code sets a business to run on the founder''s own plan' using errcode = '42501';
  end if;
  if new.funding_source <> 'own_plan' then
    new.funding_source := case when new.model_billing = 'byok' then 'own_api_key' else 'foundmill_credits' end;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger businesses_funding_source before insert or update on businesses for each row execute function fm_businesses_funding_source();
