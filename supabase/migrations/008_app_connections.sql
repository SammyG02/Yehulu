-- Connected apps (e.g. Chinka): read-only access to a user's Yehulu data,
-- only with their permission, and cancellable at any time.
-- Changes no existing rows. Run after 001-007. Safe to run more than once.
--
-- The app gets an access key once. Only a SHA-256 fingerprint of it is
-- stored, so the database never holds a working key. A key reads exactly
-- what its user can see in Yehulu (same rules), for the accounts they chose.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  app text not null check (app in ('chinka')),
  key_hash text not null unique,
  key_hint text not null,                 -- last 4 characters, to recognise it
  account_ids uuid[],                     -- null: all the user's accounts
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists app_connections_user on public.app_connections (user_id);

alter table public.app_connections enable row level security;
drop policy if exists "own connections" on public.app_connections;
create policy "own connections" on public.app_connections for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "disconnect own" on public.app_connections;
create policy "disconnect own" on public.app_connections for delete to authenticated
  using (user_id = (select auth.uid()));
-- Created only through connect_app(); never edited (disconnect = delete).
revoke insert, update on public.app_connections from authenticated, anon;
revoke all on public.app_connections from anon;

-- Signed-in user: connect an app. Returns the access key; it's shown once.
create or replace function public.connect_app(app_name text, accounts uuid[] default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  key text;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if app_name not in ('chinka') then raise exception 'Unknown app'; end if;
  if accounts is not null and exists (
    select 1 from unnest(accounts) a where not public.is_member(a)
  ) then
    raise exception 'You can only share your own accounts';
  end if;
  if (select count(*) from public.app_connections where user_id = uid) >= 10 then
    raise exception 'Up to 10 connections. Disconnect one first.';
  end if;
  key := 'ykn_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.app_connections (user_id, app, key_hash, key_hint, account_ids)
  values (uid, app_name, encode(extensions.digest(key, 'sha256'), 'hex'), right(key, 4), accounts);
  return key;
end;
$$;

-- The connected app: everything its user can see, read-only. Returns null for
-- an unknown or disconnected key.
create or replace function public.app_read(access_key text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  conn public.app_connections;
  uid uuid;
  result jsonb;
begin
  select * into conn from public.app_connections
  where key_hash = encode(extensions.digest(coalesce(access_key, ''), 'sha256'), 'hex');
  if not found then return null; end if;
  uid := conn.user_id;
  update public.app_connections set last_used_at = now() where id = conn.id;

  with mine as (
    select a.*, me.role as my_role, me.goal_target, me.goal_monthly
    from public.accounts a
    join public.account_members me on me.account_id = a.id and me.user_id = uid
    where conn.account_ids is null or a.id = any(conn.account_ids)
  )
  select jsonb_build_object(
    'app', conn.app,
    'user', (select jsonb_build_object('id', p.id, 'name', p.name) from public.profiles p where p.id = uid),
    'accounts', coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'role', a.my_role,
      'members_see_all', a.members_see_all,
      'goal', jsonb_build_object('target', a.goal_target, 'monthly', a.goal_monthly),
      'rates', (select coalesce(jsonb_agg(jsonb_build_object('from', r.from_date, 'annual_rate', r.annual_rate) order by r.from_date), '[]'::jsonb)
                from public.rates r where r.account_id = a.id),
      -- Members: everyone if you may see everyone's money (as in the app), else just you.
      'members', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', m.user_id, 'role', m.role,
                    'name', case when m.role = 'guest' then m.guest_name else coalesce(pr.name, '') end,
                    'rates', m.rates) order by m.joined_at), '[]'::jsonb)
                  from public.account_members m left join public.profiles pr on pr.id = m.user_id
                  where m.account_id = a.id
                    and (m.user_id = uid or a.my_role = 'owner' or a.members_see_all)),
      'transactions', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'member_id', t.member_id, 'type', t.type, 'amount', t.amount, 'date', t.date,
                    'note', t.note, 'no_fee', t.no_fee, 'ref', t.ref) order by t.date, t.created_at), '[]'::jsonb)
                  from public.transactions t
                  where t.account_id = a.id
                    and (t.member_id = uid or a.my_role = 'owner' or a.members_see_all))
    ) order by a.created_at), '[]'::jsonb)
  ) into result
  from mine a;
  return result;
end;
$$;

revoke execute on function public.connect_app(text, uuid[]) from public, anon;
grant execute on function public.connect_app(text, uuid[]) to authenticated;
-- The connected app calls this with only the access key (no Yehulu sign-in).
revoke execute on function public.app_read(text) from public;
grant execute on function public.app_read(text) to anon, authenticated;
