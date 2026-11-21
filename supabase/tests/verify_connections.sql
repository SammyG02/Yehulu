-- Verifies connected apps (migration 008) against the real database.
-- Paste into Supabase > SQL Editor and Run, after running 008.
-- Creates throwaway users and accounts, runs the checks, then UNDOES
-- EVERYTHING: the results appear as the "error" at the end, on purpose.

do $$
declare
  me uuid := gen_random_uuid();      -- the user who connects Chinka
  other uuid := gen_random_uuid();   -- someone else
  a1 uuid := gen_random_uuid();      -- my own account
  a2 uuid := gen_random_uuid();      -- my second account (not shared with Chinka in test 2)
  a3 uuid := gen_random_uuid();      -- someone else's account I'm a member of (they keep balances private)
  a4 uuid := gen_random_uuid();      -- someone else's account I'm not in
  k1 text; k2 text;
  data jsonb;
  n int;
  err text;
  res text := 'RESULTS (all of this was undone afterwards):';
begin
  begin
    insert into auth.users (id, email, aud, role, raw_user_meta_data, created_at, updated_at)
    values (me, 'yehulu-test-me@example.invalid', 'authenticated', 'authenticated', '{"full_name":"Test me"}', now(), now()),
           (other, 'yehulu-test-other@example.invalid', 'authenticated', 'authenticated', '{"full_name":"Test other"}', now(), now());
  exception when others then
    select id into me from auth.users order by created_at limit 1;
    select id into other from auth.users where id <> me order by created_at limit 1;
    res := res || E'\n(note: used two existing users; nothing is kept for them either)';
  end;

  -- Accounts (as admin): a1, a2 mine; a3 other's with me as member, private; a4 other's only.
  insert into public.accounts (id, name, owner_id) values (a1, 'Mine 1', me), (a2, 'Mine 2', me), (a3, 'Theirs shared', other), (a4, 'Theirs private', other);
  update public.accounts set members_see_all = false where id = a3;
  insert into public.account_members (account_id, user_id, role) values (a3, me, 'member');
  insert into public.transactions (account_id, member_id, type, amount, date, created_by) values
    (a1, me, 'deposit', 1000, '2026-01-01', me),
    (a2, me, 'deposit', 2000, '2026-01-01', me),
    (a3, me, 'deposit', 300, '2026-01-01', me),
    (a3, other, 'deposit', 9999, '2026-01-01', other),
    (a4, other, 'deposit', 7777, '2026-01-01', other);

  -- 1. Connect (as me), all accounts.
  perform set_config('request.jwt.claim.sub', me::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  k1 := public.connect_app('chinka', null);
  execute 'reset role';
  res := res || E'\n' || case when k1 ~ '^ykn_[0-9a-f]{64}$' then 'PASS' else 'FAIL' end || '  connect: a key is created (ykn_ + 64 hex)';
  select count(*) into n from public.app_connections where key_hash = k1 or key_hint = k1;
  res := res || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  the key itself is not stored (only its fingerprint)';

  -- 2. Read with the key, as the outside app (anon, no sign-in).
  execute 'set local role anon';
  data := public.app_read(k1);
  execute 'reset role';
  select count(*) into n from jsonb_array_elements(data -> 'accounts');
  res := res || E'\n' || case when n = 3 then 'PASS' else 'FAIL' end || '  reads my 3 accounts (got ' || n || '), not one I''m not in';
  select count(*) into n from jsonb_array_elements(data -> 'accounts') acc, jsonb_array_elements(acc -> 'transactions') t
    where (t ->> 'amount')::numeric in (9999, 7777);
  res := res || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  never shows others'' money I can''t see in Yehulu';
  select count(*) into n from jsonb_array_elements(data -> 'accounts') acc where acc ->> 'id' = a3::text
    and jsonb_array_length(acc -> 'members') = 1;
  res := res || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  private shared account: only me in its member list';

  -- 3. Only chosen accounts.
  perform set_config('request.jwt.claim.sub', me::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  k2 := public.connect_app('chinka', array[a1]);
  err := null;
  begin perform public.connect_app('chinka', array[a4]); exception when others then err := sqlerrm; end;
  execute 'reset role';
  execute 'set local role anon';
  data := public.app_read(k2);
  execute 'reset role';
  select count(*) into n from jsonb_array_elements(data -> 'accounts');
  res := res || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  a key for one account reads only that account (got ' || n || ')';
  res := res || E'\n' || case when err is not null then 'PASS' else 'FAIL' end || '  cannot share an account you''re not in (' || coalesce(err, 'it was allowed!') || ')';

  -- 4. The outside app can't see or change anything else.
  execute 'set local role anon';
  err := null;
  begin perform count(*) from public.app_connections; exception when others then err := sqlerrm; end;
  res := res || E'\n' || case when err is not null then 'PASS' else 'FAIL' end || '  the outside app can''t list connections';
  err := null;
  begin perform public.connect_app('chinka', null); exception when others then err := sqlerrm; end;
  res := res || E'\n' || case when err is not null then 'PASS' else 'FAIL' end || '  the outside app can''t create keys';
  data := public.app_read('ykn_' || repeat('0', 64));
  res := res || E'\n' || case when data is null then 'PASS' else 'FAIL' end || '  a made-up key reads nothing';
  execute 'reset role';

  -- 5. Someone else can't see or remove my connections.
  perform set_config('request.jwt.claim.sub', other::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.app_connections;
  delete from public.app_connections;
  execute 'reset role';
  res := res || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  another user sees none of my connections';
  select count(*) into n from public.app_connections where user_id = me;
  res := res || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || '  another user can''t remove my connections';

  -- 6. Disconnect: the key stops working at once.
  perform set_config('request.jwt.claim.sub', me::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.app_connections where key_hint = right(k1, 4);
  execute 'reset role';
  execute 'set local role anon';
  data := public.app_read(k1);
  execute 'reset role';
  res := res || E'\n' || case when data is null then 'PASS' else 'FAIL' end || '  after disconnecting, the key reads nothing';
  select (last_used_at is not null)::int into n from public.app_connections where key_hint = right(k2, 4);
  res := res || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  "last read" is recorded';

  raise exception '%', res;
end $$;
