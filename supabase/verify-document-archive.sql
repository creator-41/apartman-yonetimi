-- Synthetic metadata exercises Storage RLS; no binary files are created. Everything rolls back.
begin;
select set_config('test.admin',(select user_id::text from public.apartman_admins limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
do $$
declare p jsonb;f jsonb;initial jsonb:=public.apartman_state();fid uuid:=gen_random_uuid();private_id uuid:=gen_random_uuid();
begin
 perform set_config('test.finance',(initial-'audit')::text,true);
 p:=jsonb_build_object('operation','reserve','id',fid,'title','TEST_SHARED_ARCHIVE','category','Yönetim planı','shared',true,'fileName','test-plan.pdf','mimeType','application/pdf','bytes',120);
 f:=public.apartman_document_manage(p)->'file';
 if public.apartman_document_manage(p)->'file'<>f then raise exception 'Reserve retry changed metadata';end if;
 begin perform public.apartman_document_manage(p||jsonb_build_object('title','Different'));raise exception 'Changed ID accepted' using errcode='ZX001';exception when sqlstate 'ZX001' then raise;when others then null;end;
 begin perform public.apartman_document_manage(jsonb_build_object('operation','complete','id',fid));raise exception 'Missing bytes completed' using errcode='ZX001';exception when sqlstate 'ZX001' then raise;when others then null;end;
 insert into storage.objects(bucket_id,name,metadata) values('apartman-documents',f->>'path','{"size":120,"mimetype":"application/pdf"}');
 f:=public.apartman_document_manage(jsonb_build_object('operation','complete','id',fid))->'file';
 if f->>'uploaded'<>'true' or f->>'version'<>'1' then raise exception 'Completion failed';end if;
 if public.apartman_document_manage(jsonb_build_object('operation','complete','id',fid))->'file'<>f then raise exception 'Completion retry not stable';end if;
 if apartman_private.document_access(f->>'path','upload') then raise exception 'Uploaded bytes can be overwritten';end if;
 begin insert into storage.objects(bucket_id,name,metadata) values('apartman-documents',gen_random_uuid()::text||'.pdf','{}');raise exception 'Unreserved insert allowed' using errcode='ZX001';exception when insufficient_privilege then null;end;
 begin perform public.apartman_document_manage(p||jsonb_build_object('operation','update','expectedVersion',0));raise exception 'Stale update accepted' using errcode='ZX001';exception when sqlstate 'ZX001' then raise;when others then null;end;
 f:=public.apartman_document_manage(p||jsonb_build_object('id',private_id,'title','TEST_PRIVATE_ARCHIVE','shared',false))->'file';
 insert into storage.objects(bucket_id,name,metadata) values('apartman-documents',f->>'path','{"size":120,"mimetype":"application/pdf"}');
 perform public.apartman_document_manage(jsonb_build_object('operation','complete','id',private_id));
 perform set_config('test.public_id',fid::text,true);perform set_config('test.public_path',fid::text||'.pdf',true);perform set_config('test.private_path',private_id::text||'.pdf',true);
 if not (apartman_private.backup()->'tables')?'documents' then raise exception 'Archive backup missing';end if;
 if public.apartman_state()-'audit'<>current_setting('test.finance')::jsonb then raise exception 'Archive changed existing state';end if;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
begin
 if public.apartman_document_list()::text like '%TEST_PRIVATE_ARCHIVE%' then raise exception 'Private metadata leaked';end if;
 if public.apartman_document_list()::text not like '%TEST_SHARED_ARCHIVE%' then raise exception 'Shared file missing';end if;
 if not apartman_private.document_access(current_setting('test.public_path'),'read') or apartman_private.document_access(current_setting('test.private_path'),'read') then raise exception 'Access rule incorrect';end if;
 if (select count(*) from storage.objects where bucket_id='apartman-documents' and name=current_setting('test.public_path'))<>1 or exists(select 1 from storage.objects where bucket_id='apartman-documents' and name=current_setting('test.private_path')) then raise exception 'Storage RLS leak';end if;
 begin perform public.apartman_document_manage('{}');raise exception 'Anon write allowed';exception when insufficient_privilege then null;end;
 begin perform * from apartman_private.documents;raise exception 'Direct metadata allowed';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
select public.apartman_document_manage(jsonb_build_object('operation','archive','id',current_setting('test.public_id'),'expectedVersion',1));
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 if apartman_private.document_access(current_setting('test.public_path'),'read') or public.apartman_document_list()::text like '%TEST_SHARED_ARCHIVE%' then raise exception 'Removed file still shared';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
select public.apartman_document_manage(jsonb_build_object('operation','restore','id',current_setting('test.public_id'),'expectedVersion',2));
select public.apartman_document_manage(jsonb_build_object('operation','update','id',current_setting('test.public_id'),'expectedVersion',3,'title','TEST_HIDDEN_ARCHIVE','category','Diğer','shared',false));
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
do $$begin
 if apartman_private.document_access(current_setting('test.public_path'),'read') or public.apartman_document_list()::text like '%TEST_HIDDEN_ARCHIVE%' then raise exception 'Hidden file accessible to nonadmin';end if;
 begin perform public.apartman_document_manage('{}');raise exception 'Nonadmin write allowed';exception when insufficient_privilege then null;end;
end $$;
rollback;
