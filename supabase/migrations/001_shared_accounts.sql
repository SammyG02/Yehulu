-- Yehulu: shared savings accounts.
-- Run once in Supabase → SQL Editor. Safe to read top to bottom:
--   tables → helper checks → triggers → who-can-do-what (RLS) → app functions.
--
-- Model: an account has members (one owner). Every transaction belongs to one
-- member, and each member earns interest on their own money. The owner sets
-- the rate and chooses whether members can see each other's transactions.

-- ---------------------------------------------------------------- tables ----

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  -- true: members see everyone's transactions. false: only their own, plus the total.
  members_see_all boolean not null default true,
  -- Secret part of the invite link. null = invites turned off.
  invite_code text unique,
  created_at timestamptz not null default now()
);

create table public.account_members (
  account_id uuid not null references public.accounts on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  -- Each member's own savings goal in this account.
  goal_target numeric(14, 2) check (goal_target > 0),
  goal_monthly numeric(14, 2) not null default 0 check (goal_monthly >= 0),
  joined_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create table public.rates (
  account_id uuid not null references public.accounts on delete cascade,
  from_date date not null,
  annual_rate numeric(6, 3) not null check (annual_rate between 0 and 100),
  primary key (account_id, from_date)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  member_id uuid not null,
  type text not null check (type in ('deposit', 'withdrawal')),
  amount numeric(14, 2) not null check (amount > 0 and amount < 1000000000000),
  date date not null,
  note text not null default '' check (char_length(note) <= 60),
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A transaction always belongs to a current member of its account.
  foreign key (account_id, member_id) references public.account_members (account_id, user_id) on delete cascade
);
create index transactions_account_date on public.transactions (account_id, date);
create index account_members_user on public.account_members (user_id);

-- ------------------------------------------------------- helper checks ----
-- security definer so policies can use them without recursing into RLS.

create function public.is_member(acc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.account_members
    where account_id = acc and user_id = (select auth.uid())
  );
$$;

create function public.is_owner(acc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.account_members
    where account_id = acc and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

-- Owner always; members only when the owner allows it.
create function public.sees_all(acc uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.account_members m
    join public.accounts a on a.id = m.account_id
    where m.account_id = acc and m.user_id = (select auth.uid())
      and (m.role = 'owner' or a.members_see_all)
  );
$$;

create function public.shares_account(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.account_members mine
    join public.account_members theirs on theirs.account_id = mine.account_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

-- -------------------------------------------------------------- triggers ----

-- A profile for every Google sign-in, filled from the Google account.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Whoever creates an account is its owner.
create function public.handle_new_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.account_members (account_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;
create trigger on_account_created
  after insert on public.accounts
  for each row execute function public.handle_new_account();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger transactions_touch
  before update on public.transactions
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------- who can do what (RLS) ----

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.account_members enable row level security;
alter table public.rates enable row level security;
alter table public.transactions enable row level security;

-- Profiles: yourself and people you share an account with.
create policy "see own and co-members" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_account(id));
create policy "edit own name" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (name) on public.profiles to authenticated;

-- Accounts: members read; anyone creates their own; only the owner changes or deletes.
create policy "members read" on public.accounts for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_member(id));
create policy "create own" on public.accounts for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "owner updates" on public.accounts for update to authenticated
  using (public.is_owner(id)) with check (public.is_owner(id));
create policy "owner deletes" on public.accounts for delete to authenticated
  using (public.is_owner(id));
-- The invite code only changes through set_invite(); the owner never changes.
revoke update on public.accounts from authenticated;
grant update (name, members_see_all) on public.accounts to authenticated;

-- Members: everyone in an account sees who's in it. Joining goes through
-- join_account(). You edit your own goal; the owner removes members; anyone
-- but the owner can leave.
create policy "members read" on public.account_members for select to authenticated
  using (public.is_member(account_id));
create policy "edit own goal" on public.account_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner removes, members leave" on public.account_members for delete to authenticated
  using (role <> 'owner' and (public.is_owner(account_id) or user_id = (select auth.uid())));
revoke update on public.account_members from authenticated;
grant update (goal_target, goal_monthly) on public.account_members to authenticated;

-- Rates: members read; the owner sets them.
create policy "members read" on public.rates for select to authenticated
  using (public.is_member(account_id));
create policy "owner writes" on public.rates for all to authenticated
  using (public.is_owner(account_id)) with check (public.is_owner(account_id));

-- Transactions: see all if allowed, else only your own. Members add and edit
-- their own; the owner can add and edit anyone's.
create policy "read" on public.transactions for select to authenticated
  using (member_id = (select auth.uid()) or public.sees_all(account_id));
create policy "add" on public.transactions for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_member(account_id)
    and (member_id = (select auth.uid()) or public.is_owner(account_id))
  );
create policy "edit" on public.transactions for update to authenticated
  using (member_id = (select auth.uid()) or public.is_owner(account_id))
  with check (member_id = (select auth.uid()) or public.is_owner(account_id));
create policy "delete" on public.transactions for delete to authenticated
  using (member_id = (select auth.uid()) or public.is_owner(account_id));
revoke update on public.transactions from authenticated;
grant update (type, amount, date, note) on public.transactions to authenticated;

-- --------------------------------------------------------- app functions ----

-- Owner: turn the invite link on (a new code each time) or off (null).
create function public.set_invite(acc uuid, enabled boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  code text;
begin
  if not public.is_owner(acc) then
    raise exception 'Only the owner can change the invite link';
  end if;
  if enabled then
    code := translate(encode(extensions.gen_random_bytes(12), 'base64'), '+/=', '-_');
  end if;
  update public.accounts set invite_code = code where id = acc;
  return code;
end;
$$;

-- Before joining: which account is this link for?
create function public.invite_preview(code text)
returns table (account_id uuid, account_name text, owner_name text, member_count bigint, already_member boolean)
language sql stable security definer set search_path = '' as $$
  select a.id, a.name, coalesce(p.name, ''),
    (select count(*) from public.account_members m where m.account_id = a.id),
    exists (select 1 from public.account_members m where m.account_id = a.id and m.user_id = (select auth.uid()))
  from public.accounts a
  left join public.profiles p on p.id = a.owner_id
  where a.invite_code is not null and a.invite_code = code;
$$;

-- Join with an invite code. Returns the account id.
create function public.join_account(code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  acc uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first';
  end if;
  select id into acc from public.accounts where invite_code is not null and invite_code = code;
  if acc is null then
    raise exception 'This invite link is no longer valid';
  end if;
  insert into public.account_members (account_id, user_id, role)
  values (acc, (select auth.uid()), 'member')
  on conflict do nothing;
  return acc;
end;
$$;

-- Every transaction in an account, without saying whose. Lets members who
-- can only see their own still work out the account total (each person's
-- interest is calculated separately, so the list keeps people apart with an
-- anonymous key).
create function public.account_activity(acc uuid)
returns table (member_key text, type text, amount numeric, date date)
language sql stable security definer set search_path = '' as $$
  select md5(t.member_id::text || t.account_id::text), t.type, t.amount, t.date
  from public.transactions t
  where t.account_id = acc and public.is_member(acc);
$$;

revoke execute on function
  public.is_member(uuid), public.is_owner(uuid), public.sees_all(uuid), public.shares_account(uuid),
  public.set_invite(uuid, boolean), public.invite_preview(text), public.join_account(text), public.account_activity(uuid)
  from public, anon;
grant execute on function
  public.is_member(uuid), public.is_owner(uuid), public.sees_all(uuid), public.shares_account(uuid),
  public.set_invite(uuid, boolean), public.invite_preview(text), public.join_account(text), public.account_activity(uuid)
  to authenticated;

-- Live updates when someone else changes something.
alter publication supabase_realtime add table public.accounts, public.account_members, public.rates, public.transactions;
