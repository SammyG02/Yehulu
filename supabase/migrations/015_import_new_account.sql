-- Importing a statement into a new account: the account, its rates and its
-- lines are saved in one step, all or nothing.
-- Changes no existing rows. Run after 014. Safe to run more than once.
--
-- Safe to call twice with the same account id (a request sent again after a
-- lost connection): the second call changes nothing. Refuses statement lines
-- the person already has in another account, so the same money is never
-- counted twice, whichever phone it comes from.

create or replace function public.import_new_account(
  acc uuid,
  account_name text,
  account_rates jsonb,
  new_rows jsonb
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  already text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  -- One at a time for each person (two phones at the same moment).
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 15));

  if exists (select 1 from public.accounts a where a.id = acc and a.owner_id = uid) then
    return 0;
  end if;

  select a.name into already
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  where t.member_id = uid
    and t.ref in (select x ->> 'ref' from jsonb_array_elements(new_rows) x where x ->> 'ref' like 'y:%')
  limit 1;
  if already is not null then
    raise exception 'This statement is already in your account "%".', already;
  end if;

  insert into public.accounts (id, name, owner_id) values (acc, account_name, uid);
  insert into public.rates (account_id, from_date, annual_rate)
  select acc, (x ->> 'from')::date, (x ->> 'annual_rate')::numeric
  from jsonb_array_elements(account_rates) x;

  return public.import_statement(acc, uid, new_rows, array[]::uuid[], null, null);
end;
$$;

revoke execute on function public.import_new_account(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.import_new_account(uuid, text, jsonb, jsonb) to authenticated;

-- The app sees the new function at once.
notify pgrst, 'reload schema';
