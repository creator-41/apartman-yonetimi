-- Test-only rows and Storage metadata; no file bytes are written. Everything rolls back.
begin;
select set_config('test.admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
do $test$
declare s jsonb:=public.apartman_state();unit int;day text;cid int;
begin
 unit:=(s#>>'{units,0,id}')::int;
 select to_char(x,'YYYY-MM-DD') into day from generate_series(date '2000-01-01',date '2001-12-01',interval '1 month')x where not exists(select 1 from jsonb_array_elements(s->'charges')c where (c->>'unit_id')::int=unit and c->>'period'=to_char(x,'YYYY-MM')) order by x limit 1;
 cid:=(public.apartman_opening_charge(jsonb_build_object('unitId',unit,'amount',100,'date',day,'note','TEST_NOTICE_CHARGE'))->>'id')::int;
 perform set_config('test.unit',unit::text,true);perform set_config('test.cid',cid::text,true);
 perform set_config('test.totals',(public.apartman_state()->'totals')::text,true);
end;$test$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare unit int:=current_setting('test.unit')::int;r jsonb;again jsonb;p jsonb;failed bool;id uuid:=gen_random_uuid();second uuid:=gen_random_uuid();third uuid:=gen_random_uuid();day text:=to_char((now() at time zone 'Europe/Istanbul')::date,'YYYY-MM-DD');
begin
 p:=jsonb_build_object('requestId',id,'unitId',unit,'amount',25.01,'date',day,'note','TEST_NOTICE_PRIVATE');
 r:=public.apartman_notice_submit(p);
 if r->>'status'<>'pending' or public.apartman_state()->'totals'<>current_setting('test.totals')::jsonb then raise exception 'Submission changed finances';end if;
 again:=public.apartman_notice_submit(p);if again->>'id'<>r->>'id' or again->>'replayed'<>'true' then raise exception 'Retry duplicate';end if;
 failed:=false;begin perform public.apartman_notice_submit(p||jsonb_build_object('amount',30));exception when others then failed:=true;end;if not failed then raise exception 'Changed retry accepted';end if;
 perform public.apartman_notice_submit(p||jsonb_build_object('requestId',second,'amount',40));
 failed:=false;begin perform public.apartman_notice_submit(p||jsonb_build_object('requestId',third,'date','2099-01-01'));exception when others then failed:=true;end;if not failed then raise exception 'Future date accepted';end if;
 failed:=false;begin perform public.apartman_notice_submit(p||jsonb_build_object('requestId',third,'file',jsonb_build_object('fileName','x.pdf','mimeType','application/pdf','bytes',5242881)));exception when others then failed:=true;end;if not failed then raise exception 'Oversized file accepted';end if;
 r:=public.apartman_notice_submit(p||jsonb_build_object('requestId',third,'amount',30,'file',jsonb_build_object('fileName','TEST_NOTICE.pdf','mimeType','application/pdf','bytes',120)));
 if r->>'status'<>'uploading' then raise exception 'File submission prematurely pending';end if;
 perform set_config('test.first',id::text,true);perform set_config('test.second',second::text,true);perform set_config('test.third',third::text,true);perform set_config('test.path',r->>'path',true);perform set_config('test.token',r->>'token',true);
 if apartman_private.notice_file_access(r->>'path','read') or not apartman_private.notice_file_access(r->>'path','upload') or apartman_private.notice_file_access(gen_random_uuid()::text||'/fake.pdf','upload') then raise exception 'Anonymous storage scope wrong';end if;
 failed:=false;begin perform public.apartman_notice_complete(jsonb_build_object('id',third,'token',r->>'token'));exception when others then failed:=true;end;if not failed then raise exception 'Missing file completed';end if;
 failed:=false;begin perform public.apartman_notice_complete(jsonb_build_object('id',third,'token',gen_random_uuid()));exception when others then failed:=true;end;if not failed then raise exception 'Wrong token accepted';end if;
 failed:=false;begin perform public.apartman_notice_submit(p||jsonb_build_object('requestId',gen_random_uuid()));exception when others then failed:=true;end;if not failed then raise exception 'Rate limit bypassed';end if;
 if has_function_privilege('anon','public.apartman_notice_list()','execute') or has_function_privilege('anon','public.apartman_notice_review(jsonb)','execute') or has_table_privilege('anon','public.apartman_payment_notices','select') then raise exception 'Anonymous private grants';end if;
 if public.apartman_state()::text like '%TEST_NOTICE_PRIVATE%' or public.apartman_state()::text like '%TEST_NOTICE.pdf%' then raise exception 'Private notice leaked';end if;
end;$test$;
-- Exercise the actual Storage INSERT policy, without writing an object on disk.
insert into storage.objects(bucket_id,name,metadata) values('apartman-payment-notices',current_setting('test.path'),'{"size":120,"mimetype":"application/pdf"}');
do $test$
declare r jsonb;failed bool;
begin
 if exists(select 1 from storage.objects where bucket_id='apartman-payment-notices') then raise exception 'Anonymous storage read exposed';end if;
 failed:=false;begin insert into storage.objects(bucket_id,name,metadata) values('apartman-payment-notices',gen_random_uuid()::text||'/'||gen_random_uuid()::text||'.pdf','{}');exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Unreserved upload accepted';end if;
 r:=public.apartman_notice_complete(jsonb_build_object('id',current_setting('test.third'),'token',current_setting('test.token')));
 if r->>'status'<>'pending' or apartman_private.notice_file_access(current_setting('test.path'),'upload') then raise exception 'Finalization incorrect';end if;
 r:=public.apartman_notice_complete(jsonb_build_object('id',current_setting('test.third'),'token',current_setting('test.token')));
end;$test$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $test$ declare failed bool;begin
 failed:=false;begin perform public.apartman_notice_list();exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Non-admin list allowed';end if;
 failed:=false;begin perform public.apartman_notice_review(jsonb_build_object('id',current_setting('test.first'),'operation','approve'));exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Non-admin approve allowed';end if;
 if apartman_private.notice_file_access(current_setting('test.path'),'read') then raise exception 'Non-admin receipt exposed';end if;
end;$test$;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
do $test$
declare s jsonb:=public.apartman_state();p jsonb;plan jsonb;r jsonb;failed bool;before_cash bigint:=(s#>>'{totals,cash}')::bigint;before_debt bigint:=(s#>>'{totals,receivable}')::bigint;unit int:=current_setting('test.unit')::int;first uuid:=current_setting('test.first')::uuid;pid int;
begin
 if (select count(*) from jsonb_array_elements(public.apartman_notice_list())x where x->>'id' in (current_setting('test.first'),current_setting('test.second'),current_setting('test.third')))<>3 then raise exception 'Admin queue missing';end if;
 if not apartman_private.notice_file_access(current_setting('test.path'),'read') then raise exception 'Admin file inaccessible';end if;
 if not exists(select 1 from storage.objects where bucket_id='apartman-payment-notices' and name=current_setting('test.path')) then raise exception 'Storage admin SELECT policy failed';end if;
 select jsonb_agg(jsonb_build_object('id',c->'id','period',c->'period','amount',c->'amount','paid',c->'paid') order by c->>'period',(c->>'id')::int) into plan from jsonb_array_elements(s->'charges')c where (c->>'unit_id')::int=unit and (c->>'amount')::bigint>(c->>'paid')::bigint;
 p:=jsonb_build_object('id',first,'operation','approve','expected',plan,'confirmed',true);
 failed:=false;begin perform public.apartman_notice_review(p||jsonb_build_object('confirmed',false));exception when others then failed:=true;end;if not failed then raise exception 'Bank confirmation bypassed';end if;
 pid:=(public.apartman_action('payment',jsonb_build_object('chargeId',current_setting('test.cid')::int,'amount',1,'date','2026-01-01'))->>'count')::int;
 failed:=false;begin perform public.apartman_notice_review(p);exception when others then failed:=true;end;if not failed then raise exception 'Stale approval accepted';end if;
 perform public.apartman_action('delete-payment',jsonb_build_object('id',pid));
 r:=public.apartman_notice_review(p);
 if (r#>>'{group,amount}')::bigint<>2501 then raise exception 'Approval wrong amount';end if;
 if (public.apartman_state()#>>'{totals,cash}')::bigint<>before_cash+2501 or (public.apartman_state()#>>'{totals,receivable}')::bigint<>before_debt-2501 then raise exception 'Approval totals wrong';end if;
 r:=public.apartman_notice_review(p);if r->>'replayed'<>'true' or (public.apartman_state()#>>'{totals,cash}')::bigint<>before_cash+2501 then raise exception 'Approval retry duplicate';end if;
 failed:=false;begin perform public.apartman_notice_review(jsonb_build_object('id',first,'operation','reject'));exception when others then failed:=true;end;if not failed then raise exception 'Approved notice rejected';end if;
 perform public.apartman_notice_review(jsonb_build_object('id',current_setting('test.second'),'operation','reject','note','TEST_REJECT'));
 if (public.apartman_state()#>>'{totals,cash}')::bigint<>before_cash+2501 then raise exception 'Rejection changed cash';end if;
 failed:=false;begin perform public.apartman_notice_review(jsonb_build_object('id',current_setting('test.second'),'operation','approve','expected',plan,'confirmed',true));exception when others then failed:=true;end;if not failed then raise exception 'Rejected notice approved';end if;
 perform public.apartman_undo_payment_batch(first);
 if (public.apartman_state()#>>'{totals,cash}')::bigint<>before_cash then raise exception 'Approved notice undo wrong';end if;
 r:=public.apartman_notice_review(p);if (public.apartman_state()#>>'{totals,cash}')::bigint<>before_cash then raise exception 'Approval after undo recreated payment';end if;
 if not(public.apartman_backup()->'tables'?'paymentNotices') then raise exception 'Backup missing notices';end if;
 if has_table_privilege('authenticated','public.apartman_payment_notices','select') then raise exception 'Direct notice read allowed';end if;
end;$test$;
select 'PASS: notices, finance, retries, approvals, storage policies and privacy; all test rows rolled back' as result;
rollback;
