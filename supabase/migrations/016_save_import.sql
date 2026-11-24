-- One way to save a statement import: everything in one step, and each import
-- has an id the database remembers. Asking again with the same id (the answer
-- was lost, the person tapped again) gives the first answer and changes nothing.
-- Changes no existing rows. Run after 015. Safe to run more than once.
-- The functions from 006, 014 and 015 stay for phones still on the older app.

create table if not exists public.imports (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id uuid not null references public.accounts on delete cascade,
  added integer not null,
  created_at timestamptz not null default now()
);
create index if not exists imports_account on public.imports (account_id);
alter table public.imports enable row level security;
drop policy if exists "see own" on public.imports;
create policy "see own" on public.imports for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "add own" on public.imports;
create policy "add own" on public.imports for insert to authenticated with check (user_id = (select auth.uid()));
revoke all on public.imports from anon, authenticated;
grant select, insert on public.imports to authenticated;

-- req: {
--   import_id, account_id, member_id,
--   new_account: { name, yehulu_no, refs } or null (an existing account)
--   seen: { count, cents, days }   that person's transactions as the app had
--                                  them when it worked this out
--   rows, remove_ids, account_rates, member_rates, moves   (as in 014)
-- }
-- Returns { account_id, added }.
create or replace function public.save_import(req jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  import_id uuid := (req ->> 'import_id')::uuid;
  acc uuid := (req ->> 'account_id')::uuid;
  member uuid := (req ->> 'member_id')::uuid;
  fresh jsonb := nullif(req -> 'new_account', 'null'::jsonb);
  done public.imports;
  already text;
  now_count bigint; now_cents bigint; now_days bigint;
  total integer;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if import_id is null or acc is null or member is null then raise exception 'This import is incomplete.'; end if;

  -- One at a time: for each person (two phones), then for each account (two people).
  perform pg_advisory_xact_lock(hashtextextended('import ' || uid, 0));
  perform pg_advisory_xact_lock(hashtextextended('import ' || acc, 0));

  select * into done from public.imports i where i.id = import_id and i.user_id = uid;
  if found then
    return jsonb_build_object('account_id', done.account_id, 'added', done.added);
  end if;

  if fresh is not null then
    if member <> uid then raise exception 'A new account is always your own.'; end if;
    -- The same Yehulu account never goes into a second account: by its number,
    -- or (lines from before numbers were kept) by the lines themselves. Looks
    -- at your own money anywhere, and at everyone's in accounts you own.
    select a.name into already
    from public.transactions t
    join public.accounts a on a.id = t.account_id
    where (t.member_id = uid or a.owner_id = uid) and t.ref is not null
      and (
        starts_with(t.ref, 'y:' || nullif(fresh ->> 'yehulu_no', '') || ':')
        or (
          t.ref in (select jsonb_array_elements_text(coalesce(fresh -> 'refs', '[]'::jsonb)))
          and not exists (
            select 1 from public.transactions u
            where u.account_id = t.account_id and u.member_id = t.member_id and u.ref ~ '^y:[^:|]+:'
          )
        )
      )
    limit 1;
    if already is not null then
      raise exception 'This Yehulu account is already in "%". Choose that account instead.', already;
    end if;
    insert into public.accounts (id, name, owner_id) values (acc, fresh ->> 'name', uid);
  else
    -- Worked out from what's really there? (Another phone may have changed it.)
    select count(*), coalesce(sum(case t.type when 'deposit' then t.amount else -t.amount end) * 100, 0), coalesce(sum(t.date - date '1970-01-01'), 0)
      into now_count, now_cents, now_days
    from public.transactions t where t.account_id = acc and t.member_id = member;
    if (now_count, now_cents, now_days) is distinct from
       ((req #>> '{seen,count}')::bigint, (req #>> '{seen,cents}')::bigint, (req #>> '{seen,days}')::bigint) then
      raise exception 'This account has just changed. Nothing was imported: check it and tap again.';
    end if;
  end if;

  total := public.import_statement_dated(
    acc, member, req -> 'rows',
    array(select jsonb_array_elements_text(coalesce(req -> 'remove_ids', '[]'::jsonb))::uuid),
    nullif(req -> 'account_rates', 'null'::jsonb), nullif(req -> 'member_rates', 'null'::jsonb), req -> 'moves');
  if total <> jsonb_array_length(req -> 'rows') then
    raise exception 'Some of these lines are already there. Nothing was imported: check it and tap again.';
  end if;

  insert into public.imports (id, user_id, account_id, added) values (import_id, uid, acc, total);
  return jsonb_build_object('account_id', acc, 'added', total);
end;
$$;

revoke execute on function public.save_import(jsonb) from public, anon;
grant execute on function public.save_import(jsonb) to authenticated;

-- The app sees the new function at once.
notify pgrst, 'reload schema';
