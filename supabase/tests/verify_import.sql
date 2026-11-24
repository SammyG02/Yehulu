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
  k int;
  i1 uuid := gen_random_uuid();
  i2 uuid := gen_random_uuid();
  i3 uuid := gen_random_uuid();
  i4 uuid := gen_random_uuid();
  i5 uuid := gen_random_uuid();
  acc4 uuid := gen_random_uuid();
  acc5 uuid := gen_random_uuid();
  acc6 uuid := gen_random_uuid();
  got jsonb;
  acc2 uuid := gen_random_uuid();
  acc3 uuid := gen_random_uuid();
  p1 jsonb := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 10, 'date', '2026-03-01', 'ref', 'y:TEST:P1');
  p2 jsonb := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 20, 'date', '2026-03-02', 'ref', 'y:TEST:P2');
  p3 jsonb := jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 30, 'date', '2026-03-03', 'ref', 'y:TEST:P3');
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

  -- 6. A NEW ACCOUNT in one step (migration 015).
  res := res || E'\n' || case when to_regprocedure('public.import_new_account(uuid,text,jsonb,jsonb)') is not null then 'PASS' else 'FAIL' end || '  015: a statement can go into a new account in one step';
  if to_regprocedure('public.import_new_account(uuid,text,jsonb,jsonb)') is not null then
  res := res || E'\n' || case when not has_function_privilege('anon', 'public.import_new_account(uuid,text,jsonb,jsonb)', 'execute') and has_function_privilege('authenticated', 'public.import_new_account(uuid,text,jsonb,jsonb)', 'execute') then 'PASS' else 'FAIL' end || '  015: only signed-in people can call it';
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; n := null;
  begin select public.import_new_account(acc2, 'New test', '[{"from":"2026-01-01","annual_rate":35}]'::jsonb, jsonb_build_array(p1, p2)) into n; exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into k from public.transactions where account_id = acc2 and member_id = m;
  res := res || E'\n' || case when err is null and n = 2 and k = 2 and exists (select 1 from public.accounts where id = acc2 and owner_id = m) and exists (select 1 from public.rates where account_id = acc2 and annual_rate = 35) and exists (select 1 from public.account_members where account_id = acc2 and user_id = m and role = 'owner') then 'PASS' else 'FAIL' end || '  new account: the account, its owner, its rate and its lines are saved';
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; n := null;
  begin select public.import_new_account(acc2, 'New test', '[{"from":"2026-01-01","annual_rate":35}]'::jsonb, jsonb_build_array(p1, p2)) into n; exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into k from public.transactions where account_id = acc2;
  res := res || E'\n' || case when err is null and n = 0 and k = 2 then 'PASS' else 'FAIL' end || '  new account: the same request sent twice changes nothing';
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; n := null;
  begin select public.import_new_account(acc3, 'New test', '[{"from":"2026-01-01","annual_rate":35}]'::jsonb, jsonb_build_array(jsonb_set(p2, '{id}', to_jsonb(gen_random_uuid())), p3)) into n; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err like '%already in your account "New test"%' and not exists (select 1 from public.accounts where id = acc3) and not exists (select 1 from public.transactions where ref = 'y:TEST:P3') then 'PASS' else 'FAIL' end || '  new account: a statement you already have is refused, nothing is kept';
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; n := null;
  begin select public.import_new_account(acc3, 'New test', '[{"from":"2026-01-01","annual_rate":500}]'::jsonb, jsonb_build_array(p3)) into n; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err is not null and not exists (select 1 from public.accounts where id = acc3) then 'PASS' else 'FAIL' end || '  new account: when a step fails, not even the account is kept';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; n := null;
  begin select public.import_new_account(acc2, 'New test', '[{"from":"2026-01-01","annual_rate":35}]'::jsonb, jsonb_build_array(p3)) into n; exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into k from public.transactions where account_id = acc2;
  res := res || E'\n' || case when err is not null and k = 2 then 'PASS' else 'FAIL' end || '  new account: nobody can write into someone else''s account this way';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; n := null;
  begin select public.import_new_account(acc3, 'New test', '[{"from":"2026-01-01","annual_rate":35}]'::jsonb, jsonb_build_array(jsonb_set(p1, '{id}', to_jsonb(gen_random_uuid())))) into n; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err is null and n = 1 then 'PASS' else 'FAIL' end || '  new account: another person''s statements don''t get in the way';
  end if;

  -- 7. ONE WAY TO SAVE AN IMPORT (migration 016).
  res := res || E'\n' || case when to_regprocedure('public.save_import(jsonb)') is not null then 'PASS' else 'FAIL' end || '  016: one way to save an import';
  if to_regprocedure('public.save_import(jsonb)') is not null then
  res := res || E'\n' || case when not has_function_privilege('anon', 'public.save_import(jsonb)', 'execute') and has_function_privilege('authenticated', 'public.save_import(jsonb)', 'execute') and not has_table_privilege('anon', 'public.imports', 'select') and not has_table_privilege('authenticated', 'public.imports', 'update') then 'PASS' else 'FAIL' end || '  016: only signed-in people can call it, and its record can''t be edited';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i1, 'account_id', acc, 'member_id', o, 'new_account', 'null'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 5, 'date', '2026-04-01', 'ref', 'y:SAVE:1')), 'remove_ids', '[]'::jsonb, 'account_rates', 'null'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err is null and (got ->> 'added')::int = 1 then 'PASS' else 'FAIL' end || '  save: into an existing account';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i1, 'account_id', acc, 'member_id', o, 'new_account', 'null'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 6, 'date', '2026-04-01', 'ref', 'y:SAVE:2')), 'remove_ids', '[]'::jsonb, 'account_rates', 'null'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where ref = 'y:SAVE:2';
  res := res || E'\n' || case when err is null and n = 0 and got = jsonb_build_object('account_id', acc, 'added', 1) then 'PASS' else 'FAIL' end || '  save: the same id again gives the first answer and changes nothing';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i2, 'account_id', acc, 'member_id', o, 'new_account', 'null'::jsonb, 'seen', '{"count":0,"cents":0,"days":0}'::jsonb, 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 6, 'date', '2026-04-01', 'ref', 'y:SAVE:2')), 'remove_ids', '[]'::jsonb, 'account_rates', 'null'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where ref = 'y:SAVE:2';
  res := res || E'\n' || case when err like '%just changed%' and n = 0 then 'PASS' else 'FAIL' end || '  save: refused if the account has changed since';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i2, 'account_id', acc, 'member_id', o, 'new_account', 'null'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 6, 'date', '2026-04-01', 'ref', 'y:SAVE:1')), 'remove_ids', '[]'::jsonb, 'account_rates', 'null'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err like '%already there%' then 'PASS' else 'FAIL' end || '  save: refused if a line is already there';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i2, 'account_id', acc, 'member_id', o, 'new_account', 'null'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 6, 'date', '2026-04-01', 'ref', 'y:SAVE:2')), 'remove_ids', '[]'::jsonb, 'account_rates', '[{"from":"2026-01-01","annual_rate":500}]'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where ref = 'y:SAVE:2';
  select count(*) into k from public.imports where id = i2;
  res := res || E'\n' || case when err is not null and n = 0 and k = 0 then 'PASS' else 'FAIL' end || '  save: when a step fails nothing is kept, not even its id';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i2, 'account_id', acc, 'member_id', o, 'new_account', 'null'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 6, 'date', '2026-04-01', 'ref', 'y:SAVE:2')), 'remove_ids', '[]'::jsonb, 'account_rates', 'null'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err is null and (got ->> 'added')::int = 1 then 'PASS' else 'FAIL' end || '  save: so the same id can be tried again';
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i1, 'account_id', acc, 'member_id', m, 'new_account', 'null'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = m), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 7, 'date', '2026-04-01', 'ref', 'y:SAVE:3')), 'remove_ids', '[]'::jsonb, 'account_rates', 'null'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err is not null then 'PASS' else 'FAIL' end || '  save: someone else''s id is no use to you';
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i3, 'account_id', acc, 'member_id', o, 'new_account', 'null'::jsonb, 'seen', (select jsonb_build_object('count', 0, 'cents', 0, 'days', 0)), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 7, 'date', '2026-04-01', 'ref', 'y:SAVE:4')), 'remove_ids', '[]'::jsonb, 'account_rates', 'null'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  select count(*) into n from public.transactions where ref = 'y:SAVE:4';
  res := res || E'\n' || case when err is not null and n = 0 then 'PASS' else 'FAIL' end || '  save: a member can''t import into the owner''s money';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i3, 'account_id', acc4, 'member_id', o, 'new_account', '{"name":"Saved","yehulu_no":"NEWNO","refs":[]}'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 8, 'date', '2026-04-01', 'ref', 'y:SAVE:5')), 'remove_ids', '[]'::jsonb, 'account_rates', '[{"from":"2026-01-01","annual_rate":20}]'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err is null and (got ->> 'account_id')::uuid = acc4 and exists (select 1 from public.accounts where id = acc4 and name = 'Saved' and owner_id = o) and exists (select 1 from public.rates where account_id = acc4 and annual_rate = 20) then 'PASS' else 'FAIL' end || '  save: into a new account, with its rate';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i3, 'account_id', acc5, 'member_id', o, 'new_account', '{"name":"Saved","yehulu_no":"NEWNO","refs":[]}'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 8, 'date', '2026-04-01', 'ref', 'y:SAVE:5')), 'remove_ids', '[]'::jsonb, 'account_rates', '[{"from":"2026-01-01","annual_rate":20}]'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err is null and (got ->> 'account_id')::uuid = acc4 and not exists (select 1 from public.accounts where id = acc5) then 'PASS' else 'FAIL' end || '  save: tried again with the same id, still one new account';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i4, 'account_id', acc5, 'member_id', o, 'new_account', '{"name":"Saved","yehulu_no":"SAVE","refs":[]}'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 9, 'date', '2026-04-01', 'ref', 'y:OTHER:1')), 'remove_ids', '[]'::jsonb, 'account_rates', '[{"from":"2026-01-01","annual_rate":20}]'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err like '%already in%' and not exists (select 1 from public.accounts where id = acc5) then 'PASS' else 'FAIL' end || '  save: the same Yehulu account never goes into a second one, whatever the statement';
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i4, 'account_id', acc5, 'member_id', o, 'new_account', '{"name":"Saved","yehulu_no":"OTHER","refs":["LEGACY:1"]}'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 9, 'date', '2026-04-01', 'ref', 'y:OTHER:1')), 'remove_ids', '[]'::jsonb, 'account_rates', '[{"from":"2026-01-01","annual_rate":20}]'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err is null then 'PASS' else 'FAIL' end || '  save: another Yehulu account is fine';
  update public.transactions set ref = 'LEGACY:9' where account_id = acc5;
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null; got := null;
  begin select public.save_import(jsonb_build_object('import_id', i5, 'account_id', acc6, 'member_id', o, 'new_account', '{"name":"Saved","yehulu_no":"MORE","refs":["LEGACY:9"]}'::jsonb, 'seen', (select jsonb_build_object('count', count(*), 'cents', (coalesce(sum(case type when 'deposit' then amount else -amount end), 0) * 100)::bigint, 'days', coalesce(sum(date - date '1970-01-01'), 0)) from public.transactions where account_id = acc and member_id = o), 'rows', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'type', 'deposit', 'amount', 9, 'date', '2026-04-01', 'ref', 'y:MORE:1')), 'remove_ids', '[]'::jsonb, 'account_rates', '[{"from":"2026-01-01","annual_rate":20}]'::jsonb, 'member_rates', 'null'::jsonb, 'moves', '[]'::jsonb)) into got; exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err like '%already in%' then 'PASS' else 'FAIL' end || '  save: lines kept under their older names are recognised too';
  delete from public.accounts where id = acc4;
  select count(*) into n from public.imports where account_id = acc4;
  res := res || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  save: deleting the account forgets its imports';
  end if;

  -- Undo everything (on purpose) and show the results.
  -- The total and any failures come first, in case the list is cut off.
  raise exception '%', (select count(*) from regexp_matches(res, 'PASS  ', 'g')) || ' PASS, '
    || (select count(*) from regexp_matches(res, 'FAIL  ', 'g')) || ' FAIL (all of this was undone afterwards)'
    || coalesce((select string_agg(E'\n' || line, '') from unnest(string_to_array(res, E'\n')) line where line like 'FAIL  %'), '')
    || E'\n' || E'\n' || res;
end $$;
