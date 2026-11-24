-- Verifies statement imports against the real database, as real roles.
-- Paste into Supabase > SQL Editor and Run.
--
-- It creates a throwaway owner, member and test account, acts as each of them
-- (with the same permission rules the app gets), runs the checks, then UNDOES
-- EVERYTHING. The results appear as the "error" message at the end: that
-- error is on purpose, it's how every change is rolled back. Nothing is kept.

do $$
declare
  o uuid := gen_random_uuid();   -- owner
  m uuid := gen_random_uuid();   -- regular member
  acc uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid();  -- stand-in (bridge) lines
  b2 uuid := gen_random_uuid();
  b3 uuid := gen_random_uuid();
  res text := 'RESULTS:';
  n int;
  rate numeric;
  err text;
  r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; r5 jsonb; rm1 jsonb; rm2 jsonb; rm3 jsonb; rm4 jsonb;
begin
  -- Rows to import, built up front (as admin).
  r1 := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 1000, 'date', '2026-02-01', 'note', 't', 'no_fee', false, 'ref', 'y:TEST:1');
  r2 := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 2000, 'date', '2026-02-02', 'note', 't', 'no_fee', false, 'ref', 'y:TEST:2');
  r3 := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 3000, 'date', '2026-02-03', 'note', 't', 'no_fee', false, 'ref', 'y:TEST:3');
  r4 := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 4000, 'date', '2026-02-04', 'note', 't', 'no_fee', false, 'ref', 'y:TEST:4');
  r5 := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 5000, 'date', '2026-02-05', 'note', 't', 'no_fee', false, 'ref', 'y:TEST:5');
  rm1 := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 10, 'date', '2026-02-10', 'note', 't', 'no_fee', false, 'ref', 'y:TEST:M1');
  rm2 := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 10, 'date', '2026-02-11', 'note', 't', 'no_fee', false, 'ref', 'y:TEST:M2');
  rm3 := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 10, 'date', '2026-02-12', 'note', 't', 'no_fee', false, 'ref', 'y:TEST:M3');
  rm4 := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 10, 'date', '2026-02-13', 'note', 't', 'no_fee', false, 'ref', 'y:TEST:M4');

  -- Throwaway users (or, if the database won't allow that, two existing ones;
  -- all changes are undone either way).
  begin
    insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
    values (o, 'yehulu-test-owner@example.invalid', 'authenticated', 'authenticated', '{"full_name":"Test owner"}', now(), now()),
           (m, 'yehulu-test-member@example.invalid', 'authenticated', 'authenticated', '{"full_name":"Test member"}', now(), now());
  exception when others then
    select id into o from auth.users order by created_at limit 1;
    select id into m from auth.users where id <> o order by created_at limit 1;
    if m is null then raise exception 'Need at least two users in the project to run this test.'; end if;
    res := res || E'\n(note: used two existing users for the test; nothing is kept for them either)';
  end;

  -- 0. Migrations in place.
  select count(*) into n from pg_indexes where schemaname = 'public' and indexname = 'transactions_one_per_line';
  res := res || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  005: unique rule against duplicate statement lines exists';
  res := res || E'\n' || case when pg_get_function_result('public.account_activity(uuid)'::regprocedure) like '%row_id%' then 'PASS' else 'FAIL' end
    || '  005: activity list has row ids (long lists read page by page)';

  -- Setup as the OWNER: account (owner joins automatically), 40% rate, a bridge line.
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.accounts (id, name, owner_id) values (acc, 'Import test', o);
  insert into public.rates (account_id, from_date, annual_rate) values (acc, '2026-01-01', 40);
  insert into public.transactions (id, account_id, member_id, type, amount, date, note, no_fee, ref)
  values (b1, acc, o, 'deposit', 100, '2026-03-31', 'bridge', true, 'gap-2026-03-30:100');
  execute 'reset role';
  insert into public.account_members (account_id, user_id, role) values (acc, m, 'member');

  -- 1. OWNER import: 3 lines, replaces the bridge, sets the rate to 35%.
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.import_statement(acc, o, jsonb_build_array(r1, r2, r3), array[b1], '[{"from":"2026-01-01","annual_rate":35}]'::jsonb, null) into n;
  execute 'reset role';
  res := res || E'\n' || case when n = 3 then 'PASS' else 'FAIL' end || '  owner import: reports 3 lines added (got ' || n || ')';
  select count(*) into n from public.transactions where account_id = acc and ref in ('y:TEST:1', 'y:TEST:2', 'y:TEST:3');
  res := res || E'\n' || case when n = 3 then 'PASS' else 'FAIL' end || '  owner import: the 3 lines are saved (found ' || n || ')';
  select count(*) into n from public.transactions where id = b1;
  res := res || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  owner import: the bridge it replaces is removed';
  select annual_rate into rate from public.rates where account_id = acc;
  res := res || E'\n' || case when rate = 35 then 'PASS' else 'FAIL' end || '  owner import: account rate is now 35% (got ' || rate || ')';

  -- 2. ROLLBACK: a later step fails (an impossible 500% rate) -> nothing from that call stays.
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.transactions (id, account_id, member_id, type, amount, date, note, no_fee, ref)
  values (b2, acc, o, 'deposit', 50, '2026-04-01', 'bridge', true, 'gap-2026-03-31:50');
  err := null;
  begin
    perform public.import_statement(acc, o, jsonb_build_array(r4, r5), array[b2], '[{"from":"2026-01-01","annual_rate":500}]'::jsonb, null);
  exception when others then err := sqlerrm;
  end;
  execute 'reset role';
  res := res || E'\n' || case when err is not null then 'PASS' else 'FAIL' end || '  rollback: the failing import is refused (' || coalesce(err, 'no error!') || ')';
  select count(*) into n from public.transactions where account_id = acc and ref in ('y:TEST:4', 'y:TEST:5');
  res := res || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  rollback: none of its lines were kept (found ' || n || ')';
  select count(*) into n from public.transactions where id = b2;
  res := res || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  rollback: the bridge it would have removed is still there';
  select annual_rate into rate from public.rates where account_id = acc;
  res := res || E'\n' || case when rate = 35 then 'PASS' else 'FAIL' end || '  rollback: the rate is unchanged at 35% (got ' || rate || ')';

  -- 3. DUPLICATES: the same statement lines again (new ids) -> nothing added.
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.import_statement(acc, o,
    jsonb_build_array(jsonb_set(r1, '{id}', to_jsonb(gen_random_uuid())), jsonb_set(r2, '{id}', to_jsonb(gen_random_uuid()))),
    array[]::uuid[], null, null) into n;
  execute 'reset role';
  res := res || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  duplicates: the same lines again add 0 (added ' || n || ')';
  err := null;
  begin
    insert into public.transactions (account_id, member_id, type, amount, date, note, ref)
    values (acc, o, 'deposit', 1000, '2026-02-01', 'copy', 'y:TEST:1');
  exception when unique_violation then err := 'refused';
  end;
  res := res || E'\n' || case when err = 'refused' then 'PASS' else 'FAIL' end || '  duplicates: the database itself refuses a second copy of a line';

  -- 4. A regular MEMBER using the same function.
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin
    perform public.import_statement(acc, o, jsonb_build_array(rm1), array[]::uuid[], null, null);
  exception when others then err := sqlerrm;
  end;
  execute 'reset role';
  res := res || E'\n' || case when err is not null then 'PASS' else 'FAIL' end || '  member: cannot add money as the owner (' || coalesce(err, 'it was allowed!') || ')';

  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin
    perform public.import_statement(acc, m, jsonb_build_array(rm2), array[]::uuid[], '[{"from":"2026-01-01","annual_rate":1}]'::jsonb, null);
  exception when others then err := sqlerrm;
  end;
  execute 'reset role';
  select annual_rate into rate from public.rates where account_id = acc;
  select count(*) into n from public.transactions where ref = 'y:TEST:M2';
  res := res || E'\n' || case when err is not null and rate = 35 and n = 0 then 'PASS' else 'FAIL' end
    || '  member: cannot change the account rate (still ' || rate || '%; that call kept nothing: ' || n || ' lines)';

  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin
    perform public.import_statement(acc, m, '[]'::jsonb, array[]::uuid[], null, '[{"from":"2026-01-01","annual_rate":99}]'::jsonb);
  exception when others then err := sqlerrm;
  end;
  execute 'reset role';
  res := res || E'\n' || case when err is not null then 'PASS' else 'FAIL' end || '  member: cannot give themselves a special rate (' || coalesce(err, 'it was allowed!') || ')';

  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.transactions (id, account_id, member_id, type, amount, date, note, no_fee, ref)
  values (b3, acc, o, 'deposit', 70, '2026-04-02', 'bridge', true, 'gap-2026-04-01:70');
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  begin perform public.import_statement(acc, o, '[]'::jsonb, array[b3], null, null); exception when others then null; end;
  begin perform public.import_statement(acc, m, '[]'::jsonb, array[b3], null, null); exception when others then null; end;
  execute 'reset role';
  select count(*) into n from public.transactions where id = b3;
  res := res || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  member: cannot remove the owner''s lines';

  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.import_statement(acc, m, jsonb_build_array(rm3), array[]::uuid[], null, null) into n;
  execute 'reset role';
  res := res || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  member: can import their own money';

  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.import_statement(acc, m, jsonb_build_array(rm4), array[]::uuid[], null, '[{"from":"2026-01-01","annual_rate":2}]'::jsonb) into n;
  execute 'reset role';
  select (rates -> 0 ->> 'annual_rate')::numeric into rate from public.account_members where account_id = acc and user_id = m;
  res := res || E'\n' || case when n = 1 and rate = 2 then 'PASS' else 'FAIL' end || '  owner: can import for a member and give them their own rate';

  -- 5. CORRECTED DATES (migration 014).
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname in ('import_statement', 'import_statement_dated');
  res := res || E'\n' || case when n = 2 and to_regprocedure('public.import_statement_dated(uuid,uuid,jsonb,uuid[],jsonb,jsonb,jsonb)') is not null then 'PASS' else 'FAIL' end || '  014: the import can correct dates (and there is one of each import function)';
  if to_regprocedure('public.import_statement_dated(uuid,uuid,jsonb,uuid[],jsonb,jsonb,jsonb)') is not null then
  res := res || E'\n' || case when not has_function_privilege('anon', 'public.import_statement_dated(uuid,uuid,jsonb,uuid[],jsonb,jsonb,jsonb)', 'execute') and has_function_privilege('authenticated', 'public.import_statement_dated(uuid,uuid,jsonb,uuid[],jsonb,jsonb,jsonb)', 'execute') then 'PASS' else 'FAIL' end || '  014: only signed-in people can call it';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.import_statement_dated(acc, o, '[]'::jsonb, array[]::uuid[], null, null, jsonb_build_array(jsonb_build_object('id', r1 ->> 'id', 'from', '2026-02-01', 'to', '2026-02-06'))); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where account_id = acc and ref = 'y:TEST:1' and date = '2026-02-06';
  res := res || E'\n' || case when err is null and n = 1 then 'PASS' else 'FAIL' end || '  owner: a line''s date is corrected';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.import_statement_dated(acc, o, '[]'::jsonb, array[]::uuid[], null, null, jsonb_build_array(jsonb_build_object('id', r1 ->> 'id', 'from', '2026-02-01', 'to', '2026-02-06'))); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where account_id = acc and ref = 'y:TEST:1' and date = '2026-02-06';
  res := res || E'\n' || case when err is null and n = 1 then 'PASS' else 'FAIL' end || '  the same request sent twice is fine';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.import_statement_dated(acc, o, jsonb_build_array(r4), array[]::uuid[], null, null, jsonb_build_array(jsonb_build_object('id', r2 ->> 'id', 'from', '2026-02-02', 'to', '2026-02-07'), jsonb_build_object('id', r3 ->> 'id', 'from', '2026-01-01', 'to', '2026-02-08'))); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where account_id = acc and ((ref = 'y:TEST:2' and date = '2026-02-02') or (ref = 'y:TEST:3' and date = '2026-02-03') or ref = 'y:TEST:4');
  res := res || E'\n' || case when err is not null and n = 2 then 'PASS' else 'FAIL' end || '  changed meanwhile: the whole import is refused, nothing moves, nothing is added';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.import_statement_dated(acc, o, jsonb_build_array(r4), array[]::uuid[], '[{"from":"2026-01-01","annual_rate":500}]'::jsonb, null, jsonb_build_array(jsonb_build_object('id', r2 ->> 'id', 'from', '2026-02-02', 'to', '2026-02-07'))); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where account_id = acc and ((ref = 'y:TEST:2' and date = '2026-02-02') or ref = 'y:TEST:4');
  res := res || E'\n' || case when err is not null and n = 1 then 'PASS' else 'FAIL' end || '  rollback: when a later step fails, corrected dates go back too';
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.import_statement_dated(acc, o, '[]'::jsonb, array[]::uuid[], null, null, jsonb_build_array(jsonb_build_object('id', r2 ->> 'id', 'from', '2026-02-02', 'to', '2026-02-07'))); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where account_id = acc and ref = 'y:TEST:2' and date = '2026-02-02';
  res := res || E'\n' || case when err is not null and n = 1 then 'PASS' else 'FAIL' end || '  member: cannot move the owner''s lines';
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.import_statement_dated(acc, m, '[]'::jsonb, array[]::uuid[], null, null, jsonb_build_array(jsonb_build_object('id', r2 ->> 'id', 'from', '2026-02-02', 'to', '2026-02-07'))); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where account_id = acc and ref = 'y:TEST:2' and date = '2026-02-02';
  res := res || E'\n' || case when err is not null and n = 1 then 'PASS' else 'FAIL' end || '  member: nor by pretending they are their own';
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.import_statement_dated(acc, m, '[]'::jsonb, array[]::uuid[], null, null, jsonb_build_array(jsonb_build_object('id', rm3 ->> 'id', 'from', '2026-02-12', 'to', '2026-02-13'))); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where account_id = acc and ref = 'y:TEST:M3' and date = '2026-02-13';
  res := res || E'\n' || case when err is null and n = 1 then 'PASS' else 'FAIL' end || '  member: can correct their own line';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.import_statement_dated(acc, m, '[]'::jsonb, array[]::uuid[], null, null, jsonb_build_array(jsonb_build_object('id', rm4 ->> 'id', 'from', '2026-02-13', 'to', '2026-02-14'))); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where account_id = acc and ref = 'y:TEST:M4' and date = '2026-02-14';
  res := res || E'\n' || case when err is null and n = 1 then 'PASS' else 'FAIL' end || '  owner: can correct a member''s line';
  update public.transactions set ref = null where id = (r3 ->> 'id')::uuid;
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.import_statement_dated(acc, o, '[]'::jsonb, array[]::uuid[], null, null, jsonb_build_array(jsonb_build_object('id', r3 ->> 'id', 'from', '2026-02-03', 'to', '2026-02-09'))); exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where account_id = acc and id = (r3 ->> 'id')::uuid and date = '2026-02-03';
  res := res || E'\n' || case when err is not null and n = 1 then 'PASS' else 'FAIL' end || '  an entry someone typed in themselves is never moved';
  end if;

  -- Undo everything (on purpose) and show the results.
  -- The total and any failures come first, in case the list is cut off.
  raise exception E'% PASS, % FAIL (all of this was undone afterwards)%

%',
    (select count(*) from regexp_matches(res, E'
PASS  ', 'g')),
    (select count(*) from regexp_matches(res, E'
FAIL  ', 'g')),
    coalesce((select string_agg(E'
' || line, '') from regexp_split_to_table(res, E'
') line where line like 'FAIL  %'), ''),
    res;
end $$;
