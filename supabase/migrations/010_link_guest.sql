-- Owner: link a name-only member to the real person who joined. Their history
-- moves over (entries already there are left out), their special rate and
-- goal carry over if the person has none, and the name-only member goes.
-- All at once or not at all. Run after 001-009. Safe to run more than once.

create or replace function public.link_guest(acc uuid, guest uuid, member uuid, skip_ids uuid[] default '{}')
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  g public.account_members;
  m public.account_members;
  moved integer;
begin
  if not public.is_owner(acc) then raise exception 'Only the owner can link people'; end if;
  select * into g from public.account_members where account_id = acc and user_id = guest;
  if not found or g.role <> 'guest' then raise exception 'That is not a name-only member of this account'; end if;
  select * into m from public.account_members where account_id = acc and user_id = member;
  if not found or m.role = 'guest' then raise exception 'Link to someone who has joined this account'; end if;

  -- Entries the person already has (chosen by the app) are left out.
  delete from public.transactions
  where account_id = acc and member_id = guest and id = any(coalesce(skip_ids, '{}'));
  -- The same statement line can't be there twice for one person.
  delete from public.transactions t
  where t.account_id = acc and t.member_id = guest and t.ref is not null
    and exists (select 1 from public.transactions x where x.account_id = acc and x.member_id = member and x.ref = t.ref);

  update public.transactions set member_id = member
  where account_id = acc and member_id = guest;
  get diagnostics moved = row_count;

  update public.account_members set
    rates = coalesce(m.rates, g.rates),
    goal_target = coalesce(m.goal_target, g.goal_target),
    goal_monthly = case when coalesce(m.goal_monthly, 0) = 0 then coalesce(g.goal_monthly, 0) else m.goal_monthly end
  where account_id = acc and user_id = member;

  delete from public.account_members where account_id = acc and user_id = guest;
  return moved;
end;
$$;

revoke execute on function public.link_guest(uuid, uuid, uuid, uuid[]) from public, anon;
grant execute on function public.link_guest(uuid, uuid, uuid, uuid[]) to authenticated;
