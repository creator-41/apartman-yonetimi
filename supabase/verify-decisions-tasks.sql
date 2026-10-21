begin;
select set_config('test.apartman_admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.apartman_admin'),true);
do $test$
declare initial jsonb:=public.apartman_state();snap jsonb;d jsonb;t jsonb;did int;tid int;failed boolean;file_info jsonb;
begin
 did:=(public.apartman_work_manage('decision','{"operation":"save","title":"TEST_DECISION","body":"Karar metni","date":"2026-10-21","decisionNo":"1"}')->>'id')::int;
 tid:=(public.apartman_work_manage('task',jsonb_build_object('operation','save','title','TEST_TASK','assignee','Test','dueDate','2026-10-20','decisionId',did))->>'id')::int;
 snap:=public.apartman_state();select x into d from jsonb_array_elements(snap->'decisions') x where (x->>'id')::int=did;select x into t from jsonb_array_elements(snap->'tasks') x where (x->>'id')::int=tid;
 perform public.apartman_work_manage('task',jsonb_build_object('operation','save','id',tid,'version',t->>'version','title','TEST_TASK','status','done','decisionId',did));
 failed:=false;begin perform public.apartman_work_manage('task',jsonb_build_object('operation','save','id',tid,'version',t->>'version','title','STALE'));exception when others then failed:=true;end;if not failed then raise exception 'Stale task update allowed';end if;
 snap:=public.apartman_state();select x into t from jsonb_array_elements(snap->'tasks') x where (x->>'id')::int=tid;
 if t->>'status'<>'done' or t->>'completed_at' is null then raise exception 'Completion failed';end if;
 perform public.apartman_work_manage('task',jsonb_build_object('operation','archive','id',tid,'version',t->>'version','archived',true));
 snap:=public.apartman_state();select x into t from jsonb_array_elements(snap->'tasks') x where (x->>'id')::int=tid;
 if not (t->>'archived')::bool then raise exception 'Archive failed';end if;
 perform public.apartman_work_manage('task',jsonb_build_object('operation','archive','id',tid,'version',t->>'version','archived',false));
 perform public.apartman_work_manage('decision',jsonb_build_object('operation','save','id',did,'version',d->>'version','title','TEST_DECISION_EDITED','body','Updated','date','2026-10-21'));
 failed:=false;begin perform public.apartman_work_manage('decision',jsonb_build_object('operation','archive','id',did,'version',d->>'version','archived',true));exception when others then failed:=true;end;if not failed then raise exception 'Stale decision archive allowed';end if;
 file_info:=public.apartman_expense_manage(jsonb_build_object('operation','reserve-decision','decisionId',did,'fileName','PRIVATE_DECISION.pdf','mimeType','application/pdf','bytes',120))->'file';
 if file_info->>'expense_id' is not null or file_info->>'path' not like 'decisions/%' then raise exception 'Wrong document parent';end if;
 perform set_config('test.work_file',file_info->>'path',true);
 snap:=public.apartman_backup();if not (snap->'tables' ?& array['decisions','tasks','expenseFiles']) then raise exception 'Backup incomplete';end if;
 if public.apartman_state()->'totals' is distinct from initial->'totals' then raise exception 'Financial totals changed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 failed:=false;begin perform public.apartman_work_manage('task','{"operation":"save","title":"Unauthorized"}');exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Unauthorized write';end if;
 if apartman_private.file_access(file_info->>'path','read') or public.apartman_state()::text like '%PRIVATE_DECISION%' then raise exception 'Private document leaked';end if;
end;$test$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
begin
 if not exists(select 1 from jsonb_array_elements(public.apartman_state()->'decisions') x where x->>'title'='TEST_DECISION_EDITED') then raise exception 'Public decision missing';end if;
 if has_function_privilege('anon','public.apartman_work_manage(text,jsonb)','execute') then raise exception 'Anonymous mutation grant';end if;
end;$test$;
reset role;
update public.apartman_expense_files set uploaded=true,shared=true where path=current_setting('test.work_file');
set local role anon;
do $test$ begin
 if not apartman_private.file_access(current_setting('test.work_file'),'read') then raise exception 'Shared decision unreadable';end if;
 if public.apartman_state()::text not like '%PRIVATE_DECISION%' then raise exception 'Shared document absent';end if;
end;$test$;
rollback;
