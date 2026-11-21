-- Data integrity for statement imports. Changes no existing rows.
-- Run after 003 and 004. Safe to run more than once.

-- 1. The database itself refuses a second copy of the same statement line
--    for the same person (e.g. two phones importing at once). Lines you add
--    yourself have no ref and are never affected (NULLs are always distinct).
--    If duplicates already exist, nothing is changed and a notice lists how
--    many, so they can be looked at first.
do $$
declare
  dupes int;
begin
  select count(*) into dupes from (
    select 1 from public.transactions
    where ref is not null
    group by account_id, member_id, ref
    having count(*) > 1
  ) d;
  if dupes > 0 then
    raise notice 'Not added: % statement line(s) already appear more than once. Nothing was changed.', dupes;
  else
    create unique index if not exists transactions_one_per_line on public.transactions (account_id, member_id, ref);
  end if;
end $$;

-- 2. The anonymous activity list gets a row id, so the app can read long lists
--    page by page without skipping or repeating rows.
drop function if exists public.account_activity(uuid);
create function public.account_activity(acc uuid)
returns table (member_key text, type text, amount numeric, date date, member_rates jsonb, no_fee boolean, row_id uuid)
language sql stable security definer set search_path = '' as $$
  select md5(t.member_id::text || t.account_id::text), t.type, t.amount, t.date, m.rates, t.no_fee, t.id
  from public.transactions t
  join public.account_members m on m.account_id = t.account_id and m.user_id = t.member_id
  where t.account_id = acc and public.is_member(acc);
$$;

revoke execute on function public.account_activity(uuid) from public, anon;
grant execute on function public.account_activity(uuid) to authenticated;
