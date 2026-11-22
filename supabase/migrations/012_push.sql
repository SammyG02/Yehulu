-- Phone notifications (web push): weekly interest summary, goal reached,
-- monthly deposit reminder, and money added to a shared account.
-- Run after 001-011. Safe to run more than once. Changes no existing rows.
--
-- How it fits together:
--   - A phone that turns notifications on is saved in push_subscriptions.
--   - Every day at 9:00 (Ethiopia) Vercel runs /api/push/daily. It asks
--     push_due() for the people with phones, works out who gets what (with
--     the app's own interest maths), sends, and records it in push_sent so
--     nothing is ever sent twice. push_due() only answers with the daily
--     job's secret (stored below, and as CRON_SECRET in Vercel).
--   - After someone adds money to a shared account, the app asks
--     /api/push/activity to tell the others. push_activity() checks it's
--     real, theirs and just made, and who may see it.
--
-- After running this, store the daily job's secret (the same text as
-- CRON_SECRET in Vercel), replacing the placeholder:
--   insert into public.app_secrets (name, value) values ('cron', 'PASTE-CRON-SECRET-HERE')
--   on conflict (name) do update set value = excluded.value;

-- 1. PHONES. One row per phone, belonging to whoever turned notifications on there last.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own phones" on public.push_subscriptions;
create policy "own phones" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "remove own phones" on public.push_subscriptions;
create policy "remove own phones" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
revoke insert, update on public.push_subscriptions from authenticated, anon;
revoke all on public.push_subscriptions from anon;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text)
returns void
language sql security definer set search_path = '' as $$
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  select p_endpoint, auth.uid(), p_p256dh, p_auth
  where auth.uid() is not null and p_endpoint like 'https://%' and length(p_endpoint) < 1000
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
$$;
revoke execute on function public.push_subscribe(text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text) to authenticated;

-- 2. WHAT YOU WANT. No row: everything on, reminder on the 1st.
create table if not exists public.push_settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  weekly boolean not null default true,
  goal boolean not null default true,
  reminder boolean not null default true,
  reminder_day integer not null default 1 check (reminder_day between 1 and 28),
  shared boolean not null default true
);
alter table public.push_settings enable row level security;
drop policy if exists "own settings" on public.push_settings;
create policy "own settings" on public.push_settings for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "add own settings" on public.push_settings;
create policy "add own settings" on public.push_settings for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "change own settings" on public.push_settings;
create policy "change own settings" on public.push_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.push_settings from anon;

-- 3. WHAT WAS SENT, so nothing goes twice (e.g. 'goal' / '<account>:500000').
create table if not exists public.push_sent (
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);
alter table public.push_sent enable row level security;
revoke all on public.push_sent from anon, authenticated;

-- 4. THE DAILY JOB'S SECRET (readable by nobody but these functions).
create table if not exists public.app_secrets (
  name text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

create or replace function public.push_cron_ok(secret text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_secrets where name = 'cron' and value = secret and length(value) >= 32);
$$;
revoke execute on function public.push_cron_ok(text) from public, anon, authenticated;

-- Daily job: everyone with a phone, their settings, own money per account,
-- and what they were already sent recently.
create or replace function public.push_due(secret text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.push_cron_ok(secret) then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', u.user_id,
      'settings', coalesce((select to_jsonb(s) from public.push_settings s where s.user_id = u.user_id), '{}'::jsonb),
      'phones', (select jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth))
                 from public.push_subscriptions p where p.user_id = u.user_id),
      'sent', (select coalesce(jsonb_agg(ps.kind || '|' || ps.key), '[]'::jsonb)
               from public.push_sent ps where ps.user_id = u.user_id and ps.sent_at > now() - interval '400 days'),
      'accounts', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id, 'name', a.name,
          'goal', jsonb_build_object('target', m.goal_target, 'monthly', m.goal_monthly),
          'rates', (select coalesce(jsonb_agg(jsonb_build_object('from', r.from_date, 'annual_rate', r.annual_rate) order by r.from_date), '[]'::jsonb)
                    from public.rates r where r.account_id = a.id),
          'my_rates', m.rates,
          'transactions', (select coalesce(jsonb_agg(jsonb_build_object('type', t.type, 'amount', t.amount, 'date', t.date, 'no_fee', t.no_fee)), '[]'::jsonb)
                    from public.transactions t where t.account_id = a.id and t.member_id = u.user_id)
        )), '[]'::jsonb)
        from public.account_members m join public.accounts a on a.id = m.account_id
        where m.user_id = u.user_id)
    ))
    from (select distinct user_id from public.push_subscriptions) u
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.push_due(text) from public, authenticated;
grant execute on function public.push_due(text) to anon;

-- Daily job: record what was sent (so it never goes twice).
create or replace function public.push_mark(secret text, sent jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_cron_ok(secret) then raise exception 'Not allowed'; end if;
  insert into public.push_sent (user_id, kind, key)
  select (x ->> 'user_id')::uuid, x ->> 'kind', x ->> 'key' from jsonb_array_elements(sent) x
  on conflict do nothing;
end;
$$;
revoke execute on function public.push_mark(text, jsonb) from public, authenticated;
grant execute on function public.push_mark(text, jsonb) to anon;

-- Daily job: forget a phone the push service says is gone.
create or replace function public.push_forget(secret text, p_endpoint text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.push_cron_ok(secret) then raise exception 'Not allowed'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;
revoke execute on function public.push_forget(text, text) from public, authenticated;
grant execute on function public.push_forget(text, text) to anon;

-- 5. SHARED ACTIVITY. Called by the person who just added money (signed in).
-- Returns who to tell (phones of the others who may see it, with it on), once.
create or replace function public.push_activity(txn uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.transactions;
  acc public.accounts;
  who text;
  result jsonb;
begin
  select * into t from public.transactions where id = txn;
  if not found or t.created_by is distinct from auth.uid() or t.created_at < now() - interval '10 minutes' or t.type <> 'deposit' then
    return jsonb_build_object('phones', '[]'::jsonb);
  end if;
  select * into acc from public.accounts where id = t.account_id;
  -- Whose money: a member's own deposit, or the owner adding for someone.
  select coalesce(case when m.role = 'guest' then m.guest_name else p.name end, 'Someone') into who
  from public.account_members m left join public.profiles p on p.id = m.user_id
  where m.account_id = t.account_id and m.user_id = t.member_id;

  with targets as (
    select m.user_id from public.account_members m
    where m.account_id = t.account_id and m.role <> 'guest' and m.user_id <> auth.uid()
      and (m.role = 'owner' or acc.members_see_all)
      and coalesce((select s.shared from public.push_settings s where s.user_id = m.user_id), true)
      and not exists (select 1 from public.push_sent ps where ps.user_id = m.user_id and ps.kind = 'shared' and ps.key = txn::text)
  ), marked as (
    insert into public.push_sent (user_id, kind, key) select user_id, 'shared', txn::text from targets
    on conflict do nothing returning user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]'::jsonb)
  into result
  from public.push_subscriptions p where p.user_id in (select user_id from marked);

  return jsonb_build_object(
    'title', acc.name,
    'body', who || ' added Br ' || to_char(t.amount, 'FM999,999,999,990.00'),
    'url', '/activity',
    'phones', result
  );
end;
$$;
revoke execute on function public.push_activity(uuid) from public, anon;
grant execute on function public.push_activity(uuid) to authenticated;
