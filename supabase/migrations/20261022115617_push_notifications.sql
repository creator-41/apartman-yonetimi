-- Separate from Acısu push. No financial data or private text enters a push payload.
create table apartman_private.push_devices (
 id uuid primary key, secret_hash bytea not null, subscription jsonb not null,
 endpoint text not null unique, admin_user uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table apartman_private.push_requests (
 device_id uuid not null references apartman_private.push_devices(id) on delete cascade,
 request_id uuid not null references public.apartman_requests(id) on delete cascade,
 primary key(device_id,request_id)
);
create index push_requests_request_idx on apartman_private.push_requests(request_id);
create table apartman_private.push_deliveries (
 id bigint generated always as identity primary key,
 device_id uuid not null references apartman_private.push_devices(id) on delete cascade,
 event_key text not null, audience text not null check(audience in ('all','admin','request','test')),
 request_id uuid references public.apartman_requests(id) on delete cascade,
 kind text not null, created_at timestamptz not null default now(),
 attempts int not null default 0, next_attempt timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, finished boolean not null default false,
 unique(device_id,event_key)
);
create index push_deliveries_pending_idx on apartman_private.push_deliveries(next_attempt,id) where not finished;
create index push_deliveries_request_idx on apartman_private.push_deliveries(request_id);
alter table apartman_private.push_devices enable row level security;
alter table apartman_private.push_requests enable row level security;
alter table apartman_private.push_deliveries enable row level security;
revoke all on apartman_private.push_devices,apartman_private.push_requests,apartman_private.push_deliveries from public,anon,authenticated;

create function apartman_private.push_endpoint_valid(endpoint text) returns boolean
language sql immutable set search_path='' as $$
 select length(endpoint) between 30 and 2048 and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-zA-Z0-9-]+\.push\.apple\.com|[a-zA-Z0-9-]+\.notify\.windows\.com)/[a-zA-Z0-9_/?=.%~+:-]+$';
$$;
revoke all on function apartman_private.push_endpoint_valid(text) from public,anon,authenticated;

-- Device UUID + unguessable per-device secret controls only this subscription.
create function apartman_private.push_device(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare device uuid; secret uuid; old apartman_private.push_devices%rowtype;
 sub jsonb; ep text; req uuid; claim uuid; actor uuid;
begin
 if octet_length(payload::text)>8000 then raise exception 'Geçersiz bildirim kaydı.'; end if;
 device:=(payload->>'id')::uuid; secret:=(payload->>'token')::uuid;
 if device is null or secret is null then raise exception 'Cihaz kimliği gerekli.'; end if;
 -- Serialize capacity checks without interfering with payment/settings locks.
 perform pg_advisory_xact_lock(4817732);
 select * into old from apartman_private.push_devices where id=device for update;
 if found and old.secret_hash<>extensions.digest(secret::text,'sha256') then raise exception 'Cihaz doğrulanamadı.' using errcode='42501'; end if;
 if coalesce(payload->>'operation','save')='remove' then
  delete from apartman_private.push_devices where id=device;
  return jsonb_build_object('ok',true);
 end if;
 if payload->>'operation'='test' then
  if old.id is null then raise exception 'Önce bildirimleri açın.'; end if;
  if exists(select 1 from apartman_private.push_deliveries where device_id=device and kind='test' and created_at>now()-interval '1 minute') then raise exception 'Bir dakika sonra tekrar deneyin.'; end if;
  insert into apartman_private.push_deliveries(device_id,event_key,audience,kind) values(device,'test:'||gen_random_uuid(),'test','test');
  return jsonb_build_object('ok',true);
 end if;
 sub:=payload->'subscription';ep:=sub->>'endpoint';
 if not coalesce(apartman_private.push_endpoint_valid(ep),false) or coalesce(sub->'keys'->>'p256dh','') !~ '^B[A-Za-z0-9_-]{86}=?$' or coalesce(sub->'keys'->>'auth','') !~ '^[A-Za-z0-9_-]{22}==$|^[A-Za-z0-9_-]{22}$' then raise exception 'Geçerli tarayıcı aboneliği gerekli.'; end if;
 if coalesce((payload->>'admin')::boolean,false) then
  if not apartman_private.is_admin() then raise exception 'Yönetici yetkisi gerekli.' using errcode='42501'; end if;
  actor:=auth.uid();
 end if;
 if payload->'request' is not null and payload->'request'<>'null'::jsonb then
  req:=(payload->'request'->>'id')::uuid;claim:=(payload->'request'->>'token')::uuid;
  if not exists(select 1 from public.apartman_requests where id=req and access_token=claim) then raise exception 'Talep bağlantısı doğrulanamadı.' using errcode='42501';end if;
 end if;
 if old.id is null and (select count(*) from apartman_private.push_devices)>=100 then raise exception 'Cihaz sınırına ulaşıldı; yönetime ulaşın.';end if;
 insert into apartman_private.push_devices(id,secret_hash,subscription,endpoint,admin_user)
 values(device,extensions.digest(secret::text,'sha256'),jsonb_build_object('endpoint',ep,'keys',jsonb_build_object('p256dh',sub->'keys'->>'p256dh','auth',sub->'keys'->>'auth')),ep,actor)
 on conflict(id) do update set subscription=excluded.subscription,endpoint=excluded.endpoint,admin_user=excluded.admin_user,updated_at=clock_timestamp();
 if req is not null then
  if (select count(*) from apartman_private.push_requests where device_id=device)>=20 and not exists(select 1 from apartman_private.push_requests where device_id=device and request_id=req) then raise exception 'Bu cihazın talep sınırına ulaşıldı.';end if;
  insert into apartman_private.push_requests values(device,req) on conflict do nothing;
 end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function apartman_private.push_device(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.push_device(jsonb) to anon,authenticated;
create function public.apartman_push_device(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select apartman_private.push_device(payload)$$;
revoke all on function public.apartman_push_device(jsonb) from public;
grant execute on function public.apartman_push_device(jsonb) to anon,authenticated;

create function apartman_private.push_enqueue(event_key text,audience text,kind text,request_id uuid default null) returns void
language sql security definer set search_path='' as $$
 insert into apartman_private.push_deliveries(device_id,event_key,audience,kind,request_id)
 select d.id,$1,$2,$3,$4 from apartman_private.push_devices d where
 $2='all' or ($2='admin' and exists(select 1 from public.apartman_admins a where a.user_id=d.admin_user)) or
 ($2='request' and exists(select 1 from apartman_private.push_requests r where r.device_id=d.id and r.request_id=$4))
 on conflict(device_id,event_key) do nothing;
$$;
revoke all on function apartman_private.push_enqueue(text,text,text,uuid) from public,anon,authenticated;

create function apartman_private.push_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='apartman_notices' then
  perform apartman_private.push_enqueue('notice:'||new.id,'all','notice');
 elsif tg_table_name='apartman_decisions' then
  if not new.archived then perform apartman_private.push_enqueue('decision:'||new.id,'all','decision'); end if;
 elsif tg_table_name='apartman_payment_notices' then
  if new.path is null or new.uploaded then perform apartman_private.push_enqueue('payment-notice:'||new.id,'admin','payment');end if;
 elsif tg_table_name='apartman_requests' then
  if tg_op='INSERT' then
   if new.path is null or new.uploaded then perform apartman_private.push_enqueue('request:'||new.id,'admin','request');end if;
  else
   if new.uploaded and not old.uploaded then perform apartman_private.push_enqueue('request:'||new.id,'admin','request');end if;
   if new.reply is distinct from old.reply or new.status is distinct from old.status then
    perform apartman_private.push_enqueue('reply:'||new.id||':'||txid_current(),'request','reply',new.id);
   end if;
  end if;
 elsif tg_table_name='apartman_tasks' then
  if new.status is distinct from old.status then
   perform apartman_private.push_enqueue('reply:'||r.id||':'||txid_current(),'request','reply',r.id) from public.apartman_requests r where r.task_id=new.id;
  end if;
 end if;
 return new;
end $$;
revoke all on function apartman_private.push_event() from public,anon,authenticated;
create trigger apartman_push_notice after insert on public.apartman_notices for each row execute function apartman_private.push_event();
create trigger apartman_push_decision after insert on public.apartman_decisions for each row execute function apartman_private.push_event();
create trigger apartman_push_payment after insert or update of uploaded on public.apartman_payment_notices for each row execute function apartman_private.push_event();
create trigger apartman_push_request after insert or update of uploaded,status,reply on public.apartman_requests for each row execute function apartman_private.push_event();
create trigger apartman_push_task after update of status on public.apartman_tasks for each row execute function apartman_private.push_event();

-- Machine endpoints are service_role-only; no secrets/subscriptions in public state or backups.
create function apartman_private.push_worker(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare config jsonb; rows jsonb; item apartman_private.push_deliveries%rowtype;
begin
 if payload->>'operation'='config' then
  select decrypted_secret::jsonb into config from vault.decrypted_secrets where name='apartman_webpush';
  return config;
 elsif payload->>'operation'='claim' then
  -- Expired jobs are never sent; leases make concurrent invocations safe.
  update apartman_private.push_deliveries set finished=true where not finished and (created_at<now()-interval '1 day' or attempts>=5);
  delete from apartman_private.push_deliveries where finished and created_at<now()-interval '7 days';
  update apartman_private.push_deliveries j set finished=true from apartman_private.push_devices d where j.device_id=d.id and not j.finished and j.audience='admin' and not exists(select 1 from public.apartman_admins a where a.user_id=d.admin_user);
  with picked as (
   select id from apartman_private.push_deliveries where not finished and next_attempt<=now() and (lease_until is null or lease_until<now()) order by id limit 30 for update skip locked
  ), claimed as (
   update apartman_private.push_deliveries j set attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' from picked where j.id=picked.id returning j.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease',c.lease_token,'subscription',d.subscription,'kind',c.kind,'requestId',r.id,'requestToken',case when c.kind='reply' then r.access_token end)),'[]'::jsonb) into rows
  from claimed c join apartman_private.push_devices d on d.id=c.device_id left join public.apartman_requests r on r.id=c.request_id;
  return rows;
 elsif payload->>'operation'='finish' then
  select * into item from apartman_private.push_deliveries where id=(payload->>'id')::bigint and lease_token=(payload->>'lease')::uuid and not finished for update;
  if not found then return jsonb_build_object('ok',false);end if;
  if (payload->>'status')::int in (404,410) then delete from apartman_private.push_devices where id=item.device_id;
  else update apartman_private.push_deliveries set finished=((payload->>'status')::int between 200 and 299),lease_until=null,next_attempt=now()+interval '1 minute'*power(2,item.attempts) where id=item.id;end if;
  return jsonb_build_object('ok',true);
 end if;
 raise exception 'Geçersiz işlem.';
end $$;
revoke all on function apartman_private.push_worker(jsonb) from public,anon,authenticated;
grant usage on schema apartman_private to service_role;
grant execute on function apartman_private.push_worker(jsonb) to service_role;
create function public.apartman_push_worker(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select apartman_private.push_worker(payload)$$;
revoke all on function public.apartman_push_worker(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_push_worker(jsonb) to service_role;

-- Wake on committed queue inserts, retry due jobs once a minute, no idle Edge calls.
create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;
create function apartman_private.push_tick() returns void language plpgsql security definer set search_path='' as $$
declare secret text;
begin
 if not exists(select 1 from apartman_private.push_deliveries where not finished and next_attempt<=now() and (lease_until is null or lease_until<now())) then return;end if;
 select decrypted_secret::jsonb->>'dispatch' into secret from vault.decrypted_secrets where name='apartman_webpush';
 if secret is null then return;end if;
 perform net.http_post(url:='https://mjnnotqrcdotklqtemgm.supabase.co/functions/v1/apartman-push',headers:=jsonb_build_object('Content-Type','application/json','x-apartman-dispatch',secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function apartman_private.push_tick() from public,anon,authenticated;
create function apartman_private.push_wake() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from inserted_jobs) then perform apartman_private.push_tick();end if;
 return null;
exception when others then
 -- Network wake failures must not roll back a resident request or payment notice.
 -- The durable queue is retried by cron after the original transaction commits.
 return null;
end $$;
revoke all on function apartman_private.push_wake() from public,anon,authenticated;
create trigger apartman_push_wake after insert on apartman_private.push_deliveries referencing new table as inserted_jobs for each statement execute function apartman_private.push_wake();
select cron.schedule('apartman-push-retry','* * * * *','select apartman_private.push_tick()');
