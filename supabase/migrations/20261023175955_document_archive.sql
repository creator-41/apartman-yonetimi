create table apartman_private.documents (
 id uuid primary key,
 title text not null check(length(title) between 1 and 120),
 category text not null check(category in ('Yönetim planı','Karar defteri','Sözleşme','Fatura','Diğer')),
 path text not null unique,
 file_name text not null check(length(file_name) between 1 and 150),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
 bytes bigint not null check(bytes between 1 and 10485760),
 uploaded boolean not null default false,
 shared boolean not null default false,
 archived boolean not null default false,
 version integer not null default 0,
 created_at timestamptz not null default clock_timestamp()
);
alter table apartman_private.documents enable row level security;
revoke all on apartman_private.documents from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('apartman-documents','apartman-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']);
create function apartman_private.document_access(object_path text,operation text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from apartman_private.documents d where d.path=object_path and case operation
 when 'read' then (apartman_private.is_admin() or (d.uploaded and d.shared and not d.archived))
 when 'upload' then apartman_private.is_admin() and not d.uploaded and not d.archived
 else false end);
$$;
revoke all on function apartman_private.document_access(text,text) from public,anon,authenticated;
grant execute on function apartman_private.document_access(text,text) to anon,authenticated;
create policy apartman_documents_read on storage.objects for select to anon,authenticated
 using(bucket_id='apartman-documents' and apartman_private.document_access(name,'read'));
create policy apartman_documents_insert on storage.objects for insert to authenticated
 with check(bucket_id='apartman-documents' and apartman_private.document_access(name,'upload'));
-- Files cannot be overwritten or physically deleted through the client; removal is recoverable.
create function apartman_private.document_list() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(d) order by created_at desc,id desc),'[]') from apartman_private.documents d
 where apartman_private.is_admin() or (uploaded and shared and not archived);
$$;
revoke all on function apartman_private.document_list() from public,anon,authenticated;
grant execute on function apartman_private.document_list() to anon,authenticated;
create function apartman_private.document_manage(payload jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare op text;fid uuid;d apartman_private.documents;title_text text;category_text text;filename text;mime text;n bigint;ext text;visible boolean;actual jsonb;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>6000 then raise exception 'Geçersiz belge isteği.';end if;
 op:=payload->>'operation';fid:=(payload->>'id')::uuid;if fid is null then raise exception 'Belge kimliği gerekli.';end if;
 if op in ('reserve','update') then
  title_text:=btrim(coalesce(payload->>'title',''));category_text:=payload->>'category';
  if length(title_text) not between 1 and 120 or coalesce(category_text,'') not in ('Yönetim planı','Karar defteri','Sözleşme','Fatura','Diğer') or jsonb_typeof(payload->'shared') is distinct from 'boolean' then raise exception 'Başlık, kategori ve görünürlük seçin.';end if;
  visible:=(payload->>'shared')::boolean;
 end if;
 if op='reserve' then
  filename:=btrim(coalesce(payload->>'fileName',''));mime:=payload->>'mimeType';
  if coalesce(payload->>'bytes','') !~ '^[0-9]{1,8}$' or jsonb_typeof(payload->'bytes') is distinct from 'number' then raise exception 'Dosya boyutu geçersiz.';end if;
  n:=(payload->>'bytes')::bigint;
  if length(filename) not between 1 and 150 or n not between 1 and 10485760 or coalesce(mime,'') not in ('image/jpeg','image/png','image/webp','application/pdf') then raise exception 'JPG, PNG, WEBP veya PDF seçin; en fazla 10 MB.';end if;
  ext:=case mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.pdf' end;
  insert into apartman_private.documents(id,title,category,path,file_name,mime_type,bytes,shared)
   values(fid,title_text,category_text,fid::text||ext,filename,mime,n,visible) on conflict(id) do nothing;
  select * into d from apartman_private.documents where id=fid for update;
  if d.title<>title_text or d.category<>category_text or d.shared<>visible or d.file_name<>filename or d.mime_type<>mime or d.bytes<>n or d.archived then raise exception 'Bu belge kimliği başka bir kayıt için kullanılmış. Formu yeniden açın.';end if;
  return jsonb_build_object('ok',true,'file',to_jsonb(d));
 end if;
 select * into d from apartman_private.documents where id=fid for update;
 if not found then raise exception 'Belge bulunamadı. Listeyi yenileyin.';end if;
 if op='complete' then
  if d.archived then raise exception 'Önce belgeyi geri alın.';end if;
  if d.uploaded then return jsonb_build_object('ok',true,'file',to_jsonb(d));end if;
  select metadata into actual from storage.objects where bucket_id='apartman-documents' and name=d.path;
  if not found or (actual->>'size')::bigint is distinct from d.bytes or actual->>'mimetype' is distinct from d.mime_type then raise exception 'Dosya yüklemesi doğrulanamadı. Dosyayı tekrar seçin veya yükleme sonucunu kontrol edin.';end if;
  update apartman_private.documents set uploaded=true,version=version+1 where id=fid returning * into d;
 else
  if payload->'expectedVersion' is distinct from to_jsonb(d.version) then raise exception 'Belge başka bir ekranda değişti. Listeyi yenileyin.';end if;
  if op='update' then
   if d.archived or not d.uploaded then raise exception 'Önce yüklemeyi tamamlayın ve belgeyi geri alın.';end if;
   update apartman_private.documents set title=title_text,category=category_text,shared=visible,version=version+1 where id=fid returning * into d;
  elsif op in ('archive','restore') then
   update apartman_private.documents set archived=(op='archive'),version=version+1 where id=fid returning * into d;
  else raise exception 'Geçersiz belge işlemi.';end if;
 end if;
 insert into public.apartman_audit(action,details) values('Belge arşivi güncellendi',jsonb_build_object('id',fid,'operation',op,'title',d.title,'shared',d.shared,'archived',d.archived));
 return jsonb_build_object('ok',true,'file',to_jsonb(d));
end $$;
revoke all on function apartman_private.document_manage(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.document_manage(jsonb) to authenticated;
create function public.apartman_document_list() returns jsonb language sql stable security invoker set search_path='' as $$select apartman_private.document_list();$$;
create function public.apartman_document_manage(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.document_manage(payload);$$;
revoke all on function public.apartman_document_list() from public,anon,authenticated;
revoke all on function public.apartman_document_manage(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_document_list() to anon,authenticated;
grant execute on function public.apartman_document_manage(jsonb) to authenticated;
do $$
declare definition text;needle text:='''cashChecks'',coalesce((select jsonb_agg(to_jsonb(cc) order by checked_at,id) from apartman_private.cash_checks cc),''[]'')';
begin
 definition:=pg_get_functiondef('apartman_private.backup()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected backup definition';end if;
 execute replace(definition,needle,needle||',''documents'',coalesce((select jsonb_agg(to_jsonb(doc) order by created_at,id) from apartman_private.documents doc),''[]'')');
end $$;
