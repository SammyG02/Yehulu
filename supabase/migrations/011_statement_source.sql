-- Which statement file each imported line came from, so one file can be
-- removed on its own. Changes no existing rows (older lines just have none).
-- Run after 006. Safe to run more than once.
--   source: "file name|first day|last day" of the statement

alter table public.transactions
  add column if not exists source text check (source is null or char_length(source) <= 160);

-- The all-at-once import (006) now also saves the source.
create or replace function public.import_statement(
  acc uuid,
  member uuid,
  new_rows jsonb,
  remove_ids uuid[],
  account_rates jsonb,
  member_rates jsonb
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  added integer;
begin
  insert into public.transactions (id, account_id, member_id, type, amount, date, note, no_fee, ref, source)
  select r.id, acc, member, r.type, r.amount, r.date, coalesce(r.note, ''), coalesce(r.no_fee, false), r.ref, r.source
  from jsonb_to_recordset(new_rows) as r(id uuid, type text, amount numeric, date date, note text, no_fee boolean, ref text, source text)
  on conflict do nothing;
  get diagnostics added = row_count;

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
