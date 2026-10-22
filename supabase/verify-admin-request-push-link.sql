begin;
do $$
declare device uuid:=gen_random_uuid(); secret uuid:=gen_random_uuid();target uuid:=gen_random_uuid();admin_id uuid; jobs jsonb;job jsonb;
begin
 select user_id into admin_id from public.apartman_admins limit 1;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform public.apartman_push_device(jsonb_build_object('id',device,'token',secret,'admin',true,'subscription',jsonb_build_object('endpoint','https://fcm.googleapis.com/fcm/send/TEST_'||device,'keys',jsonb_build_object('p256dh','B'||repeat('a',86),'auth',repeat('a',22)))));
 insert into apartman_private.push_deliveries(device_id,event_key,audience,kind) values(device,'request:'||target,'admin','request');
 jobs:=public.apartman_push_worker('{"operation":"claim"}');
 select value into job from jsonb_array_elements(jobs) where value->'subscription'->>'endpoint'='https://fcm.googleapis.com/fcm/send/TEST_'||device;
 assert job->>'requestId'=target::text,'Admin notification target is missing';
 assert job->>'requestToken' is null,'Resident capability leaked into an administrator notification';
end $$;
set local role anon;
do $$begin
 begin perform public.apartman_push_worker('{"operation":"claim"}');raise exception 'Worker exposed';exception when insufficient_privilege then null;end;
 begin perform public.apartman_request_list();raise exception 'Private request list exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
