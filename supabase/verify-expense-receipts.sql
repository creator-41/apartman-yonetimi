-- Test records and metadata reservations are rolled back; no binary files are created.
begin;
select set_config('test.apartman_admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.apartman_admin'),true);
do $test$
declare initial jsonb; snap jsonb; target jsonb; expected jsonb; eid int; file_info jsonb; fid uuid; file_path text; failed boolean; item int;
begin
 initial:=public.apartman_state();
 eid:=(public.apartman_action('expense','{"category":"Elektrik","description":"TEST_RECEIPT","amount":100,"date":"2001-01-02"}')->>'count')::int;
 snap:=public.apartman_state();
 select e into target from jsonb_array_elements(snap->'expenses') e where (e->>'id')::int=eid;
 expected:=jsonb_build_object('category',target->'category','description',target->'description','amount',target->'amount','date',target->'date');
 perform public.apartman_expense_manage(jsonb_build_object('operation','update','expenseId',eid,'expected',expected,'category','Temizlik','description','TEST_EDITED','amount',75,'date','2001-02-03'));
 snap:=public.apartman_state();
 if (snap#>>'{totals,cash}')::bigint<>(initial#>>'{totals,cash}')::bigint-7500 then raise exception 'Expense edit cash incorrect';end if;
 if not exists(select 1 from jsonb_array_elements(snap->'expenses') e where (e->>'id')::int=eid and e->>'date'='2001-02-03' and e->>'description'='TEST_EDITED' and (e->>'amount')::int=7500) then raise exception 'Edit not applied';end if;
 failed:=false;begin perform public.apartman_expense_manage(jsonb_build_object('operation','update','expenseId',eid,'expected',expected,'category','Temizlik','description','TEST_EDITED','amount',80,'date','2001-02-03'));exception when others then failed:=true;end;if not failed then raise exception 'Stale update allowed';end if;
 file_info:=public.apartman_expense_manage(jsonb_build_object('operation','reserve','expenseId',eid,'fileName','PRIVATE_TEST.pdf','mimeType','application/pdf','bytes',120))->'file';
 fid:=(file_info->>'id')::uuid;file_path:=file_info->>'path';
 if not apartman_private.file_access(file_path,'upload') or not apartman_private.file_access(file_path,'read') then raise exception 'Admin access missing';end if;
 failed:=false;begin perform public.apartman_expense_manage(jsonb_build_object('operation','complete','fileId',fid));exception when others then failed:=true;end;if not failed then raise exception 'Missing file completed';end if;
 failed:=false;begin perform public.apartman_action('delete-expense',jsonb_build_object('id',eid));exception when others then failed:=true;end;if not failed then raise exception 'Expense with file reservation deleted';end if;
 for item in 1..4 loop perform public.apartman_expense_manage(jsonb_build_object('operation','reserve','expenseId',eid,'fileName','test.pdf','mimeType','application/pdf','bytes',120));end loop;
 failed:=false;begin perform public.apartman_expense_manage(jsonb_build_object('operation','reserve','expenseId',eid,'fileName','sixth.pdf','mimeType','application/pdf','bytes',120));exception when others then failed:=true;end;if not failed then raise exception 'File count limit bypassed';end if;
 failed:=false;begin perform public.apartman_expense_manage(jsonb_build_object('operation','reserve','expenseId',eid,'fileName','evil.html','mimeType','text/html','bytes',120));exception when others then failed:=true;end;if not failed then raise exception 'Bad MIME allowed';end if;
 perform set_config('test.receipt_path',file_path,true);perform set_config('test.receipt_expense',eid::text,true);
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 if apartman_private.file_access(file_path,'read') or apartman_private.file_access(file_path,'upload') or apartman_private.file_access(file_path,'delete') then raise exception 'Other account gained file access';end if;
 failed:=false;begin perform public.apartman_expense_manage(jsonb_build_object('operation','remove','fileId',fid));exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Non-admin mutation allowed';end if;
 snap:=public.apartman_state();if snap::text like '%PRIVATE_TEST%' then raise exception 'Private filename leaked';end if;
end;
$test$;
-- Exercise visibility using test-only metadata. Storage itself is never modified through SQL.
reset role;
update public.apartman_expense_files set uploaded=true,shared=true where path=current_setting('test.receipt_path');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare path text:=current_setting('test.receipt_path');snap jsonb;failed boolean:=false;
begin
 if not apartman_private.file_access(path,'read') then raise exception 'Shared read missing';end if;
 if apartman_private.file_access(path,'upload') or apartman_private.file_access(path,'delete') then raise exception 'Anonymous write allowed';end if;
 snap:=public.apartman_state();if snap::text not like '%PRIVATE_TEST.pdf%' then raise exception 'Shared file metadata not visible';end if;
 begin perform public.apartman_expense_manage('{}');exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Anonymous mutation allowed';end if;
 failed:=false;begin perform id from public.apartman_expense_files;exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'File metadata table readable';end if;
end;
$test$;
reset role;
update public.apartman_expense_files set shared=false where path=current_setting('test.receipt_path');
set local role anon;
do $test$
begin
 if apartman_private.file_access(current_setting('test.receipt_path'),'read') then raise exception 'Hidden file remains accessible';end if;
 if public.apartman_state()::text like '%PRIVATE_TEST.pdf%' then raise exception 'Hidden filename remains visible';end if;
end;
$test$;
rollback;
select 'PASS: expense edits/cash/stale writes, file reservation and completion checks, private/shared/hidden access, count limits, delete protection; rolled back' as result;
