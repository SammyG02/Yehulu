-- A statement import is saved all at once, or not at all.
-- Before this, an import was several requests (batches of transactions,
-- removing stand-in lines, rates); a dropped connection or signing out
-- halfway left part of it saved. This function does it in one transaction.
-- Changes no existing rows. Run after 003-005. Safe to run more than once.
--
-- It runs with the caller's own permissions (not elevated), so the usual
-- rules apply: members add only their own money, only the owner adds for
-- others or changes the account's rates.

create or replace function public.import_statement(
  acc uuid,
  member uuid,
  new_rows jsonb,          -- [{ id, type, amount, date, note, no_fee, ref }]
  remove_ids uuid[],       -- stand-in lines the import replaces
  account_rates jsonb,     -- [{ from, annual_rate }] or null to leave as is
  member_rates jsonb       -- same, for the member's own rate, or null
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  added integer;
begin
  -- A line that's already there (same statement line) is skipped, never doubled.
  insert into public.transactions (id, account_id, member_id, type, amount, date, note, no_fee, ref)
  select r.id, acc, member, r.type, r.amount, r.date, coalesce(r.note, ''), coalesce(r.no_fee, false), r.ref
  from jsonb_to_recordset(new_rows) as r(id uuid, type text, amount numeric, date date, note text, no_fee boolean, ref text)
  on conflict do nothing;
  get diagnostics added = row_count;

  -- Only stand-in lines (they always carry a statement reference) can be
  -- removed here: a transaction you entered yourself never is.
  if remove_ids is not null and cardinality(remove_ids) > 0 then
    delete from public.transactions
    where account_id = acc and member_id = member and id = any(remove_ids) and ref is not null
      and (ref like 'gap-%' or ref like 'opening-%');
  end if;

  if account_rates is not null then
    delete from public.rates where account_id = acc;
    insert into public.rates (account_id, from_date, annual_rate)
    select acc, (x ->> 'from')::date, (x ->> 'annual_rate')::numeric
    from jsonb_array_elements(account_rates) x;
  end if;

  if member_rates is not null then
    perform public.set_member_rates(acc, member, member_rates);
  end if;

  return added;
end;
$$;

revoke execute on function public.import_statement(uuid, uuid, jsonb, uuid[], jsonb, jsonb) from public, anon;
grant execute on function public.import_statement(uuid, uuid, jsonb, uuid[], jsonb, jsonb) to authenticated;
