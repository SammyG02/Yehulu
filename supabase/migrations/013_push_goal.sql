-- Goal reached straight away when your own deposit takes you past it.
-- The app celebrates on the phone you're using; this tells your other phones
-- and records it, so the 9:00 job doesn't send it again.
-- Run after 012. Safe to run more than once. Changes no existing rows.

create or replace function public.push_goal(acc uuid, target numeric, this_phone text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  my_target numeric;
  acc_name text;
  phones jsonb;
  is_new boolean;
begin
  if uid is null then return jsonb_build_object('phones', '[]'::jsonb); end if;
  -- Only your own goal in an account you're in.
  select m.goal_target, a.name into my_target, acc_name
  from public.account_members m join public.accounts a on a.id = m.account_id
  where m.account_id = acc and m.user_id = uid;
  if my_target is null or my_target <> target then return jsonb_build_object('phones', '[]'::jsonb); end if;

  -- Same key as the daily job: '<account>:500000' (no trailing zeros).
  insert into public.push_sent (user_id, kind, key)
  values (uid, 'goal', acc::text || ':' || (case when position('.' in target::text) > 0
    then rtrim(rtrim(target::text, '0'), '.') else target::text end))
  on conflict do nothing
  returning true into is_new;
  if is_new is null then return jsonb_build_object('phones', '[]'::jsonb); end if;

  select coalesce(jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth)), '[]'::jsonb)
  into phones
  from public.push_subscriptions p
  where p.user_id = uid and p.endpoint is distinct from this_phone
    and coalesce((select s.goal from public.push_settings s where s.user_id = uid), true);

  return jsonb_build_object('name', acc_name, 'phones', phones);
end;
$$;
revoke execute on function public.push_goal(uuid, numeric, text) from public, anon;
grant execute on function public.push_goal(uuid, numeric, text) to authenticated;
