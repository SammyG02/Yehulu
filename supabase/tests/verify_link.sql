-- Verifies linking a name-only member (migration 010). Paste into Supabase >
-- SQL Editor and Run after 010. Undoes everything; results show as the
-- "error" at the end, on purpose.

do $$
declare
  o uuid := gen_random_uuid();   -- owner
  m uuid := gen_random_uuid();   -- the person who joined
  g uuid := gen_random_uuid();   -- name-only member
  g2 uuid := gen_random_uuid();  -- another name-only member
  acc uuid := gen_random_uuid();
  dup uuid := gen_random_uuid(); -- an entry the person already has
  n int;
  err text;
  rate numeric;
  res text := 'RESULTS (all of this was undone afterwards):';
begin
  begin
    insert into auth.users (id, email, aud, role, created_at, updated_at)
    values (o, 'yehulu-test-o@example.invalid', 'authenticated', 'authenticated', now(), now()),
           (m, 'yehulu-test-m@example.invalid', 'authenticated', 'authenticated', now(), now());
  exception when others then
    select id into o from auth.users order by created_at limit 1;
    select id into m from auth.users where id <> o order by created_at limit 1;
    res := res || E'\n(note: used two existing users; nothing is kept for them either)';
  end;
  insert into public.accounts (id, name, owner_id) values (acc, 'Link test', o);
  insert into public.account_members (account_id, user_id, role) values (acc, m, 'member');
  insert into public.account_members (account_id, user_id, role, guest_name, rates, goal_target)
  values (acc, g, 'guest', 'Abebe', '[{"from":"2026-01-01","annual_rate":2}]', 50000), (acc, g2, 'guest', 'Other', null, null);
  insert into public.transactions (id, account_id, member_id, type, amount, date, created_by) values
    (gen_random_uuid(), acc, g, 'deposit', 1000, '2026-01-01', o),
    (gen_random_uuid(), acc, g, 'deposit', 2000, '2026-02-01', o),
    (dup, acc, g, 'deposit', 3000, '2026-03-01', o),
    (gen_random_uuid(), acc, m, 'deposit', 3000, '2026-03-02', m);

  -- A regular member can't link.
  perform set_config('request.jwt.claim.sub', m::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.link_guest(acc, g, m, array[dup]); exception when others then err := sqlerrm; end;
  execute 'reset role';
  res := res || E'\n' || case when err is not null then 'PASS' else 'FAIL' end || '  a member cannot link (' || coalesce(err, 'allowed!') || ')';

  -- The owner can't link to another name-only member (only to someone who joined).
  perform set_config('request.jwt.claim.sub', o::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  err := null;
  begin perform public.link_guest(acc, g, g2, '{}'); exception when others then err := sqlerrm; end;
  res := res || E'\n' || case when err is not null then 'PASS' else 'FAIL' end || '  cannot link to another name-only member (' || coalesce(err, 'allowed!') || ')';

  -- The owner links Abebe to the person, leaving out the entry they already have.
  select public.link_guest(acc, g, m, array[dup]) into n;
  execute 'reset role';
  res := res || E'\n' || case when n = 2 then 'PASS' else 'FAIL' end || '  2 entries moved (got ' || n || ')';
  select count(*) into n from public.transactions where account_id = acc and member_id = m;
  res := res || E'\n' || case when n = 3 then 'PASS' else 'FAIL' end || '  the person now has 3 entries (their 1 + 2 moved; found ' || n || ')';
  select count(*) into n from public.transactions where id = dup;
  res := res || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  the double was left out (not counted twice)';
  select count(*) into n from public.account_members where account_id = acc and user_id = g;
  res := res || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || '  the name-only member is gone';
  select (rates -> 0 ->> 'annual_rate')::numeric, goal_target into rate, n from public.account_members where account_id = acc and user_id = m;
  res := res || E'\n' || case when rate = 2 and n = 50000 then 'PASS' else 'FAIL' end || '  special rate (2%) and goal (50,000) carried over';
  select count(*) into n from public.account_members where account_id = acc and user_id = g2;
  res := res || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || '  other name-only members are untouched';

  raise exception '%', res;
end $$;
