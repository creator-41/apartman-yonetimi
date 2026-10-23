-- Synthetic records only; all changes, queued notifications and metadata roll back.
begin;
select set_config('test.admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
do $$declare u int;begin
 insert into public.apartman_units(label) values('TEST_NOTICE_TRACKING') returning id into u;
 insert into public.apartman_charges(unit_id,period,amount) values(u,'2000-01',10000);
 perform set_config('test.unit',u::text,true);
 perform set_config('test.finances',(public.apartman_state()->'totals')::text,true);
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$declare id uuid:=gen_random_uuid();secret uuid:=gen_random_uuid();p jsonb;r jsonb;begin
 p:=jsonb_build_object('requestId',id,'trackingToken',secret,'unitId',current_setting('test.unit')::int,'amount',25,'date',(now() at time zone 'Europe/Istanbul')::date,'note','PRIVATE_SUBMISSION_NOTE');
 r:=public.apartman_notice_submit(p);
 perform set_config('test.notice',id::text,true);perform set_config('test.secret',secret::text,true);perform set_config('test.payload',p::text,true);
 assert r->>'status'='pending';
 assert (public.apartman_notice_submit(p)->>'replayed')::bool,'Same credentials did not replay';
 begin perform public.apartman_notice_submit(p-'trackingToken');raise exception 'Missing replay secret accepted';exception when raise_exception then if sqlerrm='Missing replay secret accepted' then raise;end if;end;
 begin perform public.apartman_notice_submit(p||jsonb_build_object('trackingToken',gen_random_uuid()));raise exception 'Wrong replay secret accepted';exception when raise_exception then if sqlerrm='Wrong replay secret accepted' then raise;end if;end;
 assert public.apartman_notice_track(jsonb_build_array(jsonb_build_object('id',id,'token',gen_random_uuid())))='[]'::jsonb,'Wrong secret exposed status';
 assert public.apartman_notice_track(jsonb_build_array(jsonb_build_object('id',id)))='[]'::jsonb,'ID-only access exposed status';
 assert public.apartman_notice_track(jsonb_build_array(jsonb_build_object('unitId',current_setting('test.unit'))))='[]'::jsonb,'Unit-only access exposed status';
 r:=public.apartman_notice_track(jsonb_build_array(jsonb_build_object('id',id,'token',secret)));
 assert jsonb_array_length(r)=1 and r#>>'{0,status}'='pending';
 assert r::text not like '%PRIVATE_SUBMISSION_NOTE%' and not ((r->0)?'path') and not ((r->0)?'upload_token') and not ((r->0)?'tracking_token'),'Private fields exposed';
 assert public.apartman_state()->'totals'=current_setting('test.finances')::jsonb,'Tracking changed balances';
 assert public.apartman_state()::text not like '%'||secret::text||'%','Shared state exposed secret';
 begin perform public.apartman_notice_track((select jsonb_agg(jsonb_build_object('id',id,'token',secret)) from generate_series(1,51)));raise exception 'Unbounded tracking';exception when raise_exception then if sqlerrm='Unbounded tracking' then raise;end if;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
do $$declare plan jsonb;r jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'period',c.period,'amount',c.amount,'paid',0) order by c.period,c.id),'[]') into plan from jsonb_array_elements(public.apartman_state()->'charges') x cross join lateral jsonb_to_record(x) as c(id int,unit_id int,period text,amount bigint) where c.unit_id=current_setting('test.unit')::int;
 perform public.apartman_notice_review(jsonb_build_object('id',current_setting('test.notice'),'operation','approve','confirmed',true,'expected',plan,'note','TEST_APPROVED_MESSAGE'));
 perform set_config('test.after_approval',(public.apartman_state()->'totals')::text,true);
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$declare r jsonb;begin
 r:=public.apartman_notice_track(jsonb_build_array(jsonb_build_object('id',current_setting('test.notice'),'token',current_setting('test.secret'))));
 assert r#>>'{0,status}'='approved' and r#>>'{0,review_note}'='TEST_APPROVED_MESSAGE';
 assert jsonb_array_length(r#>'{0,payments}')=1 and (r#>>'{0,payments,0,active}')::bool,'Approved receipt missing';
 assert not ((r->0)?'reviewed_by') and not ((r->0)?'request'),'Admin fields leaked';
 assert public.apartman_state()->'totals'=current_setting('test.after_approval')::jsonb;
 begin perform 1 from public.apartman_payment_notices;raise exception 'Direct table read allowed';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
select public.apartman_undo_payment_batch(current_setting('test.notice')::uuid);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$declare r jsonb;begin
 r:=public.apartman_notice_track(jsonb_build_array(jsonb_build_object('id',current_setting('test.notice'),'token',current_setting('test.secret'))));
 assert r#>>'{0,status}'='approved' and not (r#>>'{0,payments,0,active}')::bool,'Cancelled payment still active';
 assert public.apartman_state()->'totals'=current_setting('test.finances')::jsonb;
end $$;
reset role;
-- Rejection, unfinished upload and legacy rows never expose a receipt or gain a secret retroactively.
do $$declare target_id uuid:=current_setting('test.notice')::uuid;secret uuid:=current_setting('test.secret')::uuid;r jsonb;begin
 update public.apartman_payment_notices set status='rejected',review_note='TEST_REJECTED_MESSAGE' where apartman_payment_notices.id=target_id;
 r:=public.apartman_notice_track(jsonb_build_array(jsonb_build_object('id',target_id,'token',secret)));
 assert r#>>'{0,status}'='rejected' and r#>>'{0,review_note}'='TEST_REJECTED_MESSAGE' and r#>'{0,payments}'='[]'::jsonb;
 update public.apartman_payment_notices set status='uploading' where apartman_payment_notices.id=target_id;
 r:=public.apartman_notice_track(jsonb_build_array(jsonb_build_object('id',target_id,'token',secret)));assert r#>>'{0,status}'='uploading' and r#>'{0,payments}'='[]'::jsonb;
 update public.apartman_payment_notices set tracking_token=null where apartman_payment_notices.id=target_id;
 assert public.apartman_notice_track(jsonb_build_array(jsonb_build_object('id',target_id,'token',secret)))='[]'::jsonb,'Legacy row claimed';
 assert not has_table_privilege('anon','public.apartman_payment_notices','select') and not has_function_privilege('anon','public.apartman_notice_review(jsonb)','execute');
end $$;
rollback;
