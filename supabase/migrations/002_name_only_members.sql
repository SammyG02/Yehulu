-- Yehulu: members without a Google sign-in ("name-only" members).
-- Run once in Supabase → SQL Editor, after 001_shared_accounts.sql.
--
-- The owner can add someone by name. Their deposits and withdrawals are
-- recorded by the owner, and they earn interest on their own money like any
-- other member. They have role 'guest', a guest_name, and a made-up user_id
-- that no real sign-in will ever have, so every existing rule keeps working
-- (transactions still point at (account_id, user_id); nobody can ever sign in
-- as a guest).

-- A guest's user_id isn't a real sign-in, so it can't point at auth.users.
alter table public.account_members drop constraint account_members_user_id_fkey;

alter table public.account_members drop constraint account_members_role_check;
alter table public.account_members
  add constraint account_members_role_check check (role in ('owner', 'member', 'guest'));

alter table public.account_members
  add column guest_name text check (guest_name is null or char_length(guest_name) between 1 and 40);
alter table public.account_members
  add constraint guests_have_names check ((role = 'guest') = (guest_name is not null));

-- Without the foreign key, remove a real person's memberships ourselves when
-- their sign-in is deleted (as the foreign key used to).
create function public.handle_deleted_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.account_members where user_id = old.id and role <> 'guest';
  return old;
end;
$$;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

-- Owner: add someone by name. Returns their member id.
create function public.add_guest(acc uuid, guest text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := gen_random_uuid();
  clean text := btrim(guest);
begin
  if not public.is_owner(acc) then
    raise exception 'Only the owner can add people';
  end if;
  if clean is null or clean = '' or char_length(clean) > 40 then
    raise exception 'Give a name of up to 40 characters';
  end if;
  insert into public.account_members (account_id, user_id, role, guest_name)
  values (acc, gid, 'guest', clean);
  return gid;
end;
$$;

-- Owner: fix a name-only member's name.
create function public.rename_guest(acc uuid, guest uuid, new_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  clean text := btrim(new_name);
begin
  if not public.is_owner(acc) then
    raise exception 'Only the owner can rename people';
  end if;
  if clean is null or clean = '' or char_length(clean) > 40 then
    raise exception 'Give a name of up to 40 characters';
  end if;
  update public.account_members set guest_name = clean
  where account_id = acc and user_id = guest and role = 'guest';
end;
$$;

revoke execute on function public.add_guest(uuid, text), public.rename_guest(uuid, uuid, text) from public, anon;
grant execute on function public.add_guest(uuid, text), public.rename_guest(uuid, uuid, text) to authenticated;
