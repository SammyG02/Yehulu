-- Request limits for connected apps (per access key).
-- Run after 008. Safe to run more than once. Changes no existing rows.
--   60 requests a minute, 5,000 a day, per key.

create table if not exists public.app_usage (
  connection_id uuid not null references public.app_connections on delete cascade,
  kind text not null check (kind in ('minute', 'day')),
  bucket timestamptz not null,
  n integer not null default 0,
  primary key (connection_id, kind, bucket)
);
alter table public.app_usage enable row level security;
revoke all on public.app_usage from anon, authenticated;

-- Checks a key and counts the request. Returns
--   { "ok": true, "user_id": ..., "account_ids": [...] }        allowed
--   { "ok": false, "reason": "key" }                            unknown or disconnected key
--   { "ok": false, "reason": "limit", "retry_after": seconds }  too many requests
create or replace function public.app_check(access_key text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  conn public.app_connections;
  per_minute integer;
  per_day integer;
  minute timestamptz := date_trunc('minute', now());
  day timestamptz := date_trunc('day', now());
begin
  select * into conn from public.app_connections
  where key_hash = encode(extensions.digest(coalesce(access_key, ''), 'sha256'), 'hex');
  if not found then return jsonb_build_object('ok', false, 'reason', 'key'); end if;

  insert into public.app_usage (connection_id, kind, bucket, n) values (conn.id, 'minute', minute, 1)
  on conflict (connection_id, kind, bucket) do update set n = public.app_usage.n + 1
  returning n into per_minute;
  insert into public.app_usage (connection_id, kind, bucket, n) values (conn.id, 'day', day, 1)
  on conflict (connection_id, kind, bucket) do update set n = public.app_usage.n + 1
  returning n into per_day;

  -- Old counters aren't needed.
  delete from public.app_usage where connection_id = conn.id and bucket < now() - interval '2 days';

  if per_minute > 60 then
    return jsonb_build_object('ok', false, 'reason', 'limit',
      'retry_after', ceil(extract(epoch from (minute + interval '1 minute' - now()))));
  end if;
  if per_day > 5000 then
    return jsonb_build_object('ok', false, 'reason', 'limit',
      'retry_after', ceil(extract(epoch from (day + interval '1 day' - now()))));
  end if;
  return jsonb_build_object('ok', true, 'user_id', conn.user_id, 'account_ids', conn.account_ids);
end;
$$;

revoke execute on function public.app_check(text) from public;
grant execute on function public.app_check(text) to anon, authenticated;
