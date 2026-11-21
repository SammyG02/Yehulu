-- Removing an imported statement, all at once or not at all.
-- Changes no existing rows. Run after 006. Safe to run more than once.
--
-- Runs with the caller's own permissions, so the usual rules apply (members
-- remove only their own money; the owner anyone's). Only lines that came from
-- a statement, or its stand-ins, can be removed: entries you added yourself
-- (no statement reference) never are.

create or replace function public.remove_statement_lines(
  acc uuid,
  member uuid,
  remove_ids uuid[],   -- statement lines and stand-ins to remove
  new_rows jsonb       -- bridges that keep later statements matching the bank
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  removed integer;
begin
  insert into public.transactions (id, account_id, member_id, type, amount, date, note, no_fee, ref)
  select r.id, acc, member, r.type, r.amount, r.date, coalesce(r.note, ''), coalesce(r.no_fee, false), r.ref
  from jsonb_to_recordset(coalesce(new_rows, '[]'::jsonb)) as r(id uuid, type text, amount numeric, date date, note text, no_fee boolean, ref text)
  where r.ref like 'gap-%'
  on conflict do nothing;

  delete from public.transactions
  where account_id = acc and member_id = member and id = any(remove_ids)
    and ref is not null and (ref like 'y:%' or ref like 'gap-%' or ref like 'opening-%');
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.remove_statement_lines(uuid, uuid, uuid[], jsonb) from public, anon;
grant execute on function public.remove_statement_lines(uuid, uuid, uuid[], jsonb) to authenticated;
