-- Importing a statement can also correct the dates of lines imported earlier,
-- in the same all-at-once save (so nobody ever sees half of it).
-- Changes no existing rows. Run after 011. Safe to run more than once, and
-- 006 or 011 can be run again after it.

do $$
begin
  if not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'source') then
    raise exception 'Run 011_statement_source.sql first, then this again.';
  end if;
end $$;

-- An earlier version of this file added a 7-part import_statement and removed
-- the original: put that right (the original is exactly as in 011).
drop function if exists public.import_statement(uuid, uuid, jsonb, uuid[], jsonb, jsonb, jsonb);

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

-- The same import, after correcting dates: both or neither.
--   moves: [{ id, from, to }]  only if the line still has the date `from` (or already
--   has `to`: the same request sent twice is fine)
create or replace function public.import_statement_dated(
  acc uuid,
  member uuid,
  new_rows jsonb,
  remove_ids uuid[],
  account_rates jsonb,
  member_rates jsonb,
  moves jsonb
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  moved integer;
begin
  -- First, so a line someone changed meanwhile stops the whole import.
  update public.transactions t
  set date = m."to"
  from jsonb_to_recordset(coalesce(moves, '[]'::jsonb)) as m(id uuid, "from" date, "to" date)
  where t.id = m.id and t.account_id = acc and t.member_id = member
    and t.ref is not null and t.date in (m."from", m."to");
  get diagnostics moved = row_count;
  if moved <> jsonb_array_length(coalesce(moves, '[]'::jsonb)) then
    raise exception 'Some of these lines changed meanwhile. Nothing was imported: try again.';
  end if;

  return public.import_statement(acc, member, new_rows, remove_ids, account_rates, member_rates);
end;
$$;

revoke execute on function public.import_statement_dated(uuid, uuid, jsonb, uuid[], jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.import_statement_dated(uuid, uuid, jsonb, uuid[], jsonb, jsonb, jsonb) to authenticated;

-- The app sees the new version at once.
notify pgrst, 'reload schema';
