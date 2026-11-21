-- Importing Yehulu statements.
--   no_fee: some debits have no 0.2% fee on a statement (e.g. standing orders).
--   ref:    the statement line a transaction came from, so importing the same
--           statement again doesn't add it twice.
-- Run after 003. Safe to run more than once.

-- 003 adds this too; here as well in case 004 is run first.
alter table public.account_members add column if not exists rates jsonb;

alter table public.transactions
  add column if not exists no_fee boolean not null default false,
  add column if not exists ref text check (ref is null or char_length(ref) <= 80);

create index if not exists transactions_ref on public.transactions (account_id, ref) where ref is not null;

-- Editing a transaction can also change whether it has a fee.
revoke update on public.transactions from authenticated;
grant update (type, amount, date, note, no_fee) on public.transactions to authenticated;

-- The anonymous activity list (for account totals) needs to know which
-- debits have no fee.
drop function if exists public.account_activity(uuid);
create function public.account_activity(acc uuid)
returns table (member_key text, type text, amount numeric, date date, member_rates jsonb, no_fee boolean)
language sql stable security definer set search_path = '' as $$
  select md5(t.member_id::text || t.account_id::text), t.type, t.amount, t.date, m.rates, t.no_fee
  from public.transactions t
  join public.account_members m on m.account_id = t.account_id and m.user_id = t.member_id
  where t.account_id = acc and public.is_member(acc);
$$;

revoke execute on function public.account_activity(uuid) from public, anon;
grant execute on function public.account_activity(uuid) to authenticated;
