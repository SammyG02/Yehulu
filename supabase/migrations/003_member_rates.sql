-- Optional rate per member. Yehulu rates differ from person to person, so the
-- owner can give one member their own rate history. Null means the member
-- earns the account's rate (the default for everyone).
--   rates: [{ "from": "2026-01-01", "annual_rate": 2 }, ...]
-- Safe to run more than once.

alter table public.account_members add column if not exists rates jsonb;

-- Owner only: set (or clear, with null) a member's own rates.
create or replace function public.set_member_rates(acc uuid, member uuid, new_rates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
begin
  if not public.is_owner(acc) then
    raise exception 'Only the owner can set rates';
  end if;
  if new_rates is not null then
    if jsonb_typeof(new_rates) <> 'array' or jsonb_array_length(new_rates) = 0 or jsonb_array_length(new_rates) > 50 then
      raise exception 'Give between 1 and 50 rates';
    end if;
    for item in select * from jsonb_array_elements(new_rates) loop
      if (item ->> 'from') !~ '^\d{4}-\d{2}-\d{2}$'
        or (item ->> 'annual_rate') is null
        or (item ->> 'annual_rate')::numeric < 0
        or (item ->> 'annual_rate')::numeric > 100 then
        raise exception 'Each rate needs a date and a rate from 0 to 100';
      end if;
    end loop;
  end if;
  update public.account_members set rates = new_rates
  where account_id = acc and user_id = member;
end;
$$;

-- The anonymous activity list also says which rates each person earns, so
-- account totals are right even when members can't see each other's money.
-- (If 004 already ran, this is replaced again when 004 is run after it.)
drop function if exists public.account_activity(uuid);
create function public.account_activity(acc uuid)
returns table (member_key text, type text, amount numeric, date date, member_rates jsonb)
language sql stable security definer set search_path = '' as $$
  select md5(t.member_id::text || t.account_id::text), t.type, t.amount, t.date, m.rates
  from public.transactions t
  join public.account_members m on m.account_id = t.account_id and m.user_id = t.member_id
  where t.account_id = acc and public.is_member(acc);
$$;

revoke execute on function public.set_member_rates(uuid, uuid, jsonb), public.account_activity(uuid) from public, anon;
grant execute on function public.set_member_rates(uuid, uuid, jsonb), public.account_activity(uuid) to authenticated;
