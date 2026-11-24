-- The daily charge some kinds of Yehulu account have: each person's own
-- history, [{ from, amount }] (0 = stopped). It's worked out by the app, never
-- saved as transactions. Changes no existing rows (nobody has one until they
-- turn it on). Run after 016. Safe to run more than once.

alter table public.account_members add column if not exists charges jsonb;

-- Your own, or anyone's if you own the account.
create or replace function public.set_charges(acc uuid, member uuid, new_charges jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
begin
  if auth.uid() is null or not (member = auth.uid() or public.is_owner(acc)) then
    raise exception 'Only you or the owner can set this.';
  end if;
  if new_charges is null or jsonb_typeof(new_charges) <> 'array' or jsonb_array_length(new_charges) > 50 then
    raise exception 'Give at most 50 charges.';
  end if;
  for item in select * from jsonb_array_elements(new_charges) loop
    if (item ->> 'from') is null or (item ->> 'from') !~ '^\d{4}-\d{2}-\d{2}$'
      or jsonb_typeof(item -> 'amount') is distinct from 'number'
      or (item ->> 'amount')::numeric < 0 or (item ->> 'amount')::numeric > 100000 then
      raise exception 'Each charge needs a date and an amount from 0 to 100,000.';
    end if;
  end loop;
  update public.account_members set charges = nullif(new_charges, '[]'::jsonb)
  where account_id = acc and user_id = member;
  if not found then raise exception 'That person is not in this account.'; end if;
end;
$$;
revoke execute on function public.set_charges(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_charges(uuid, uuid, jsonb) to authenticated;

-- The same as in 008 and 012, plus each person's charges and where each line
-- came from, so connected apps and notifications show the same balance.
create or replace function public.app_read(access_key text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  conn public.app_connections;
  uid uuid;
  result jsonb;
begin
  select * into conn from public.app_connections
  where key_hash = encode(extensions.digest(coalesce(access_key, ''), 'sha256'), 'hex');
  if not found then return null; end if;
  uid := conn.user_id;
  update public.app_connections set last_used_at = now() where id = conn.id;

  with mine as (
    select a.*, me.role as my_role, me.goal_target, me.goal_monthly
    from public.accounts a
    join public.account_members me on me.account_id = a.id and me.user_id = uid
    where conn.account_ids is null or a.id = any(conn.account_ids)
  )
  select jsonb_build_object(
    'app', conn.app,
    'user', (select jsonb_build_object('id', p.id, 'name', p.name) from public.profiles p where p.id = uid),
    'accounts', coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'role', a.my_role,
      'members_see_all', a.members_see_all,
      'goal', jsonb_build_object('target', a.goal_target, 'monthly', a.goal_monthly),
      'rates', (select coalesce(jsonb_agg(jsonb_build_object('from', r.from_date, 'annual_rate', r.annual_rate) order by r.from_date), '[]'::jsonb)
                from public.rates r where r.account_id = a.id),
      -- Members: everyone if you may see everyone's money (as in the app), else just you.
      'members', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', m.user_id, 'role', m.role,
                    'name', case when m.role = 'guest' then m.guest_name else coalesce(pr.name, '') end,
                    'rates', m.rates, 'charges', m.charges) order by m.joined_at), '[]'::jsonb)
                  from public.account_members m left join public.profiles pr on pr.id = m.user_id
                  where m.account_id = a.id
                    and (m.user_id = uid or a.my_role = 'owner' or a.members_see_all)),
      'transactions', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', t.id, 'member_id', t.member_id, 'type', t.type, 'amount', t.amount, 'date', t.date,
                    'note', t.note, 'no_fee', t.no_fee, 'ref', t.ref, 'source', t.source) order by t.date, t.created_at), '[]'::jsonb)
                  from public.transactions t
                  where t.account_id = a.id
                    and (t.member_id = uid or a.my_role = 'owner' or a.members_see_all))
    ) order by a.created_at), '[]'::jsonb)
  ) into result
  from mine a;
  return result;
end;
$$;

revoke execute on function public.app_read(text) from public;
grant execute on function public.app_read(text) to anon, authenticated;

create or replace function public.push_due(secret text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.push_cron_ok(secret) then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', u.user_id,
      'settings', coalesce((select to_jsonb(s) from public.push_settings s where s.user_id = u.user_id), '{}'::jsonb),
      'phones', (select jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth))
                 from public.push_subscriptions p where p.user_id = u.user_id),
      'sent', (select coalesce(jsonb_agg(ps.kind || '|' || ps.key), '[]'::jsonb)
               from public.push_sent ps where ps.user_id = u.user_id and ps.sent_at > now() - interval '400 days'),
      'accounts', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id, 'name', a.name,
          'goal', jsonb_build_object('target', m.goal_target, 'monthly', m.goal_monthly),
          'rates', (select coalesce(jsonb_agg(jsonb_build_object('from', r.from_date, 'annual_rate', r.annual_rate) order by r.from_date), '[]'::jsonb)
                    from public.rates r where r.account_id = a.id),
          'my_rates', m.rates,
          'my_charges', m.charges,
          'transactions', (select coalesce(jsonb_agg(jsonb_build_object('type', t.type, 'amount', t.amount, 'date', t.date, 'no_fee', t.no_fee, 'ref', t.ref, 'source', t.source)), '[]'::jsonb)
                    from public.transactions t where t.account_id = a.id and t.member_id = u.user_id)
        )), '[]'::jsonb)
        from public.account_members m join public.accounts a on a.id = m.account_id
        where m.user_id = u.user_id)
    ))
    from (select distinct user_id from public.push_subscriptions) u
  ), '[]'::jsonb);
end;
$$;

revoke execute on function public.push_due(text) from public, authenticated;
grant execute on function public.push_due(text) to anon;

notify pgrst, 'reload schema';
