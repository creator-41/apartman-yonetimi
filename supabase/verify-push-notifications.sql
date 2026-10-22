-- Synthetic fixtures only; every write, queue item and pg_net request rolls back.
begin;
do $$
declare d1 uuid:=gen_random_uuid();d2 uuid:=gen_random_uuid();secret1 uuid:=gen_random_uuid();secret2 uuid:=gen_random_uuid();
 admin_id uuid; req uuid; cap uuid; notice_id int; decision_id int; new_task int; unit_id int;
 sub1 jsonb;sub2 jsonb;before_totals jsonb;after_totals jsonb;claimed jsonb;job jsonb;state jsonb;
begin
 select user_id into admin_id from public.apartman_admins limit 1;
 select id into unit_id from public.apartman_units order by id limit 1;
 if admin_id is null or unit_id is null then raise exception 'Existing admin/unit required for verification.';end if;
 before_totals:=public.apartman_state()->'totals';
 sub1:=jsonb_build_object('endpoint','https://fcm.googleapis.com/fcm/send/TEST_'||d1,'keys',jsonb_build_object('p256dh','B'||repeat('a',86),'auth',repeat('a',22)));
 sub2:=jsonb_set(sub1,'{endpoint}',to_jsonb('https://fcm.googleapis.com/fcm/send/TEST_'||d2));
 perform set_config('request.jwt.claim.sub','',true);
 perform public.apartman_push_device(jsonb_build_object('id',d1,'token',secret1,'subscription',sub1));
 begin
  perform public.apartman_push_device(jsonb_build_object('id',d1,'token',secret2,'operation','remove'));raise exception 'Wrong secret accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.apartman_push_device(jsonb_build_object('id',d2,'token',secret2,'subscription',sub2,'admin',true));raise exception 'Nonadmin accepted';
 exception when insufficient_privilege then null;end;
 begin
  perform public.apartman_push_device(jsonb_build_object('id',d2,'token',secret2,'subscription',jsonb_set(sub2,'{endpoint}','"https://127.0.0.1/private"')));raise exception 'SSRF accepted';
 exception when raise_exception then if sqlerrm='SSRF accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform public.apartman_push_device(jsonb_build_object('id',d2,'token',secret2,'subscription',sub2,'admin',true));
 insert into public.apartman_notices(title,body) values('TEST_PUSH','PRIVATE NOTICE BODY') returning id into notice_id;
 insert into public.apartman_decisions(title,body,date) values('TEST_PUSH','PRIVATE DECISION BODY',current_date) returning id into decision_id;
 assert (select count(*) from apartman_private.push_deliveries where device_id in(d1,d2) and event_key in ('notice:'||notice_id,'decision:'||decision_id))=4,'Public event targeting';
 req:=gen_random_uuid();cap:=gen_random_uuid();
 insert into public.apartman_requests(id,unit_id,title,body,request,access_token) values(req,unit_id,'TEST_PUSH','PRIVATE REQUEST BODY','{}',cap);
 assert (select count(*) from apartman_private.push_deliveries where device_id=d1 and event_key='request:'||req)=0,'Request leaked to resident';
 assert (select count(*) from apartman_private.push_deliveries where device_id=d2 and event_key='request:'||req)=1,'Admin request missing';
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.apartman_push_device(jsonb_build_object('id',d1,'token',secret1,'subscription',sub1,'request',jsonb_build_object('id',req,'token',gen_random_uuid())));raise exception 'Wrong tracking token accepted';
 exception when insufficient_privilege then null;end;
 perform public.apartman_push_device(jsonb_build_object('id',d1,'token',secret1,'subscription',sub1,'request',jsonb_build_object('id',req,'token',cap)));
 insert into public.apartman_tasks(title,notes) values('TEST_PUSH','') returning id into new_task;
 update public.apartman_requests set task_id=new_task where id=req;
 update public.apartman_tasks set status='in_progress',updated_at=clock_timestamp() where id=new_task;
 update public.apartman_requests set status='in_progress',reply='PRIVATE REPLY',updated_at=clock_timestamp() where id=req;
 assert (select count(*) from apartman_private.push_deliveries where device_id=d1 and request_id=req and kind='reply')=1,'Same transaction duplicated reply';
 assert (select count(*) from apartman_private.push_deliveries where device_id=d2 and request_id=req)=0,'Reply leaked to other device';
 -- Logout demotes administrator subscriptions before future admin deliveries.
 perform public.apartman_push_device(jsonb_build_object('id',d2,'token',secret2,'subscription',sub2,'admin',false));
 claimed:=public.apartman_push_worker('{"operation":"claim"}');
 assert not exists(select 1 from jsonb_array_elements(claimed) j where j->>'kind'='request' and j->'subscription'->>'endpoint'=sub2->>'endpoint'),'Demoted administrator claimed private event';
 select j into job from jsonb_array_elements(claimed) j where j->'subscription'->>'endpoint'=sub1->>'endpoint' limit 1;
 assert job is not null,'Worker did not lease';
 assert not exists(select 1 from jsonb_array_elements(public.apartman_push_worker('{"operation":"claim"}')) j where j->>'id'=job->>'id'),'Lease duplicate';
 assert public.apartman_push_worker(jsonb_build_object('operation','finish','id',job->>'id','lease',gen_random_uuid(),'status',201))->>'ok'='false','Stale lease accepted';
 perform public.apartman_push_worker(jsonb_build_object('operation','finish','id',job->>'id','lease',job->>'lease','status',503));
 assert (select not finished and next_attempt>now() from apartman_private.push_deliveries where id=(job->>'id')::bigint),'Transient retry missing';
 state:=public.apartman_state();assert state::text not like '%fcm.googleapis.com%' and state::text not like '%'||secret1||'%','Subscription leaked through state';
 after_totals:=state->'totals';assert before_totals=after_totals,'Financial totals changed';
 perform public.apartman_push_device(jsonb_build_object('id',d1,'token',secret1,'operation','remove'));
 assert not exists(select 1 from apartman_private.push_requests where device_id=d1),'Opt-out claims persisted';
 assert not exists(select 1 from apartman_private.push_deliveries where device_id=d1),'Opt-out queue persisted';
end $$;
set local role anon;
do $$begin
 begin perform public.apartman_push_worker('{"operation":"config"}');raise exception 'Secret RPC accessible';exception when insufficient_privilege then null;end;
 begin perform 1 from apartman_private.push_devices;raise exception 'Subscription table accessible';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
