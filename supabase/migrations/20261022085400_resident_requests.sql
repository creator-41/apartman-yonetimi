-- STEP: table_storage
create table public.apartman_requests(
 id uuid primary key,unit_id integer not null references public.apartman_units(id),
 title text not null check(length(title) between 3 and 100),
 body text not null check(length(body) between 10 and 2000),
 location text not null default '' check(length(location)<=100),
 request jsonb not null,access_token uuid not null default gen_random_uuid(),
 status text not null default 'received' check(status in('received','in_progress','done')),
 reply text not null default '' check(length(reply)<=1000),
 path text unique,file_name text,mime_type text,bytes bigint,uploaded boolean not null default false,
 task_id integer unique references public.apartman_tasks(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default clock_timestamp()
);
create index apartman_requests_unit_date_idx on public.apartman_requests(unit_id,created_at);
create index apartman_requests_date_idx on public.apartman_requests(created_at desc);
alter table public.apartman_requests enable row level security;
revoke all on public.apartman_requests from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('apartman-request-photos','apartman-request-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create function apartman_private.request_file_access(object_path text,operation text)
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.apartman_requests n where n.path=object_path and case operation
 when 'read' then apartman_private.is_admin()
 when 'upload' then not n.uploaded and n.created_at>now()-interval '30 minutes'
 else false end);$$;
revoke all on function apartman_private.request_file_access(text,text) from public,anon,authenticated;
grant execute on function apartman_private.request_file_access(text,text) to anon,authenticated;
create policy apartman_request_photos_insert on storage.objects for insert to anon,authenticated
 with check(bucket_id='apartman-request-photos' and apartman_private.request_file_access(name,'upload'));
create policy apartman_request_photos_read on storage.objects for select to authenticated
 using(bucket_id='apartman-request-photos' and apartman_private.request_file_access(name,'read'));

-- STEP: info
create function apartman_private.request_info(target uuid,admin_view boolean default false)
returns jsonb language sql stable security invoker set search_path=''
as $$select jsonb_build_object('id',n.id,'unit_id',n.unit_id,'title',n.title,'body',n.body,'location',n.location,
 'status',case when t.id is null then n.status when t.status='pending' then 'received' else t.status end,
 'reply',n.reply,'created_at',n.created_at,'version',n.updated_at::text,'task_id',n.task_id,'task_version',t.updated_at::text,
 'uploaded',n.uploaded,'has_photo',n.path is not null)
 ||case when admin_view then jsonb_build_object('path',n.path,'file_name',n.file_name) else '{}'::jsonb end
 from public.apartman_requests n left join public.apartman_tasks t on t.id=n.task_id where n.id=target;$$;
revoke all on function apartman_private.request_info(uuid,boolean) from public,anon,authenticated;

-- STEP: submit
create function apartman_private.request_submit(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $submit$
declare nid uuid;unit integer;heading text;description text;place text;f jsonb;canonical jsonb;n public.apartman_requests%rowtype;fname text;mime text;size bigint;ext text;object_path text;token uuid:=gen_random_uuid();day_start timestamptz:=date_trunc('day',now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul';
begin
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>15000 then raise exception 'Geçersiz talep.';end if;
 nid:=(payload->>'requestId')::uuid;unit:=(payload->>'unitId')::integer;heading:=btrim(coalesce(payload->>'title',''));description:=btrim(coalesce(payload->>'body',''));place:=btrim(coalesce(payload->>'location',''));f:=payload->'file';
 if nid is null or unit is null or length(heading) not between 3 and 100 or length(description) not between 10 and 2000 or length(place)>100 then raise exception 'Daire, başlık ve açıklamayı kontrol edin.';end if;
 if f is not null and f<>'null'::jsonb then
  if jsonb_typeof(f)<>'object' then raise exception 'Geçersiz fotoğraf.';end if;
  fname:=btrim(coalesce(f->>'fileName',''));mime:=f->>'mimeType';size:=(f->>'bytes')::bigint;
  if length(fname) not between 1 and 150 or mime is null or mime not in('image/jpeg','image/png','image/webp') or size is null or size not between 1 and 5242880 then raise exception 'Fotoğraf JPG, PNG veya WEBP ve en fazla 5 MB olmalıdır.';end if;
  ext:=case mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end;
  object_path:=nid::text||'/'||token::text||ext;
 end if;
 canonical:=jsonb_build_object('unitId',unit,'title',heading,'body',description,'location',place,'file',case when object_path is null then null else jsonb_build_object('fileName',fname,'mimeType',mime,'bytes',size) end);
 perform id from public.apartman_settings where id=1 for update;
 select * into n from public.apartman_requests where id=nid;
 if found then
  if n.request is distinct from canonical then raise exception 'Bu işlem numarası farklı bilgilerle kullanılmış. İlk gönderimi kontrol edin.';end if;
  return jsonb_build_object('ok',true,'id',n.id,'token',n.access_token,'path',n.path,'uploaded',n.uploaded,'replayed',true);
 end if;
 if not exists(select 1 from public.apartman_units where id=unit) then raise exception 'Daire bulunamadı.';end if;
 if (select count(*) from public.apartman_requests where unit_id=unit and created_at>=day_start)>=3 or
    (select count(*) from public.apartman_requests where created_at>=day_start)>=30 or
    (select count(*) from public.apartman_requests rr left join public.apartman_tasks tt on tt.id=rr.task_id where coalesce(tt.status,rr.status)<>'done')>=200 then raise exception 'Talep sınırına ulaşıldı. Yöneticiyle görüşün.';end if;
 insert into public.apartman_requests(id,unit_id,title,body,location,request,access_token,path,file_name,mime_type,bytes)
 values(nid,unit,heading,description,place,canonical,token,object_path,fname,mime,size) returning * into n;
 return jsonb_build_object('ok',true,'id',n.id,'token',n.access_token,'path',n.path,'uploaded',false);
end;$submit$;
revoke all on function apartman_private.request_submit(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.request_submit(jsonb) to anon,authenticated;
create function public.apartman_request_submit(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.request_submit(payload);$$;
revoke all on function public.apartman_request_submit(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_request_submit(jsonb) to anon,authenticated;

-- STEP: track_complete
create function apartman_private.request_track(payload jsonb)
returns jsonb language plpgsql stable security definer set search_path=''
as $track$
declare target uuid;
begin
 if payload is null or octet_length(payload::text)>1000 then raise exception 'Geçersiz takip bilgisi.';end if;
 select id into target from public.apartman_requests where id=(payload->>'id')::uuid and access_token=(payload->>'token')::uuid;
 if not found then raise exception 'Talep bulunamadı veya takip bağlantısı geçersiz.';end if;
 return apartman_private.request_info(target,false)-'version'-'task_version';
end;$track$;
revoke all on function apartman_private.request_track(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.request_track(jsonb) to anon,authenticated;
create function public.apartman_request_track(payload jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select apartman_private.request_track(payload);$$;
revoke all on function public.apartman_request_track(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_request_track(jsonb) to anon,authenticated;
create function apartman_private.request_complete(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $complete$
declare n public.apartman_requests%rowtype;actual jsonb;
begin
 if payload is null or octet_length(payload::text)>1000 then raise exception 'Geçersiz istek.';end if;
 select * into n from public.apartman_requests where id=(payload->>'id')::uuid and access_token=(payload->>'token')::uuid for update;
 if not found then raise exception 'Talep bulunamadı.';end if;
 if n.uploaded or n.path is null then return jsonb_build_object('ok',true);end if;
 if n.created_at<=now()-interval '30 minutes' then raise exception 'Fotoğraf yükleme süresi dolmuş. Yöneticiyle görüşün.';end if;
 select metadata into actual from storage.objects where bucket_id='apartman-request-photos' and name=n.path;
 if not found or (actual->>'size')::bigint is distinct from n.bytes or actual->>'mimetype' is distinct from n.mime_type then raise exception 'Fotoğraf yüklemesi tamamlanmadı.';end if;
 update public.apartman_requests set uploaded=true,updated_at=clock_timestamp() where id=n.id;
 return jsonb_build_object('ok',true);
end;$complete$;
revoke all on function apartman_private.request_complete(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.request_complete(jsonb) to anon,authenticated;
create function public.apartman_request_complete(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.request_complete(payload);$$;
revoke all on function public.apartman_request_complete(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_request_complete(jsonb) to anon,authenticated;

-- STEP: manage
create function apartman_private.request_manage(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $manage$
declare n public.apartman_requests%rowtype;t public.apartman_tasks%rowtype;result jsonb;next_status text;public_status text;response text:=btrim(coalesce(payload->>'reply',''));
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or octet_length(payload::text)>12000 or length(response)>1000 then raise exception 'Geçersiz talep işlemi.';end if;
 perform id from public.apartman_settings where id=1 for update;
 select * into n from public.apartman_requests where id=(payload->>'id')::uuid for update;
 if not found then raise exception 'Talep bulunamadı.';end if;
 if payload->>'operation'='task' and n.task_id is not null then return jsonb_build_object('ok',true,'id',n.task_id,'replayed',true);end if;
 if payload->>'version' is distinct from n.updated_at::text then raise exception 'Talep değişmiş. Listeyi yenileyin.';end if;
 if n.task_id is not null then
  select * into t from public.apartman_tasks where id=n.task_id for update;
  if payload->>'taskVersion' is distinct from t.updated_at::text then raise exception 'Bağlı görev değişmiş. Listeyi yenileyin.';end if;
 end if;
 if payload->>'operation'='status' then
  next_status:=payload->>'status';if next_status is null or next_status not in('received','in_progress','done') then raise exception 'Geçerli durum seçin.';end if;
  if n.task_id is not null then
   public_status:=case next_status when 'received' then 'pending' else next_status end;
   perform apartman_private.task_save(jsonb_build_object('id',t.id,'version',t.updated_at::text,'title',t.title,'notes',t.notes,'assignee',t.assignee,'dueDate',coalesce(t.due_date::text,''),'status',public_status,'decisionId',coalesce(t.decision_id::text,'')));
  end if;
  update public.apartman_requests set status=next_status,reply=response,updated_at=clock_timestamp() where id=n.id;
 elsif payload->>'operation'='task' then
  if payload->'confirmed' is distinct from 'true'::jsonb then raise exception 'Ortak ekranda paylaşılacak görev bilgilerini kontrol edin.';end if;
  result:=apartman_private.task_save(jsonb_build_object('title',payload->>'title','notes',coalesce(payload->>'notes',''),'assignee',coalesce(payload->>'assignee',''),'dueDate',coalesce(payload->>'dueDate',''),'status',case n.status when 'received' then 'pending' else n.status end));
  update public.apartman_requests set task_id=(result->>'id')::integer,updated_at=clock_timestamp() where id=n.id;
 else raise exception 'Geçersiz işlem.';end if;
 insert into public.apartman_audit(action,details) values(case when payload->>'operation'='task' then 'Talepten görev oluşturuldu' else 'Talep durumu güncellendi' end,jsonb_build_object('requestId',n.id,'status',next_status,'taskId',result->'id'));
 return jsonb_build_object('ok',true,'id',result->'id');
end;$manage$;
revoke all on function apartman_private.request_manage(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.request_manage(jsonb) to authenticated;
create function public.apartman_request_manage(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.request_manage(payload);$$;
revoke all on function public.apartman_request_manage(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_request_manage(jsonb) to authenticated;

-- STEP: list_backup
create function apartman_private.request_list()
returns jsonb language plpgsql stable security definer set search_path=''
as $list$
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(apartman_private.request_info(n.id,true) order by n.open desc,n.created_at desc) from (
 select n.id,n.created_at,coalesce(t.status,n.status)<>'done' as open from public.apartman_requests n left join public.apartman_tasks t on t.id=n.task_id order by (coalesce(t.status,n.status)<>'done') desc,n.created_at desc limit 300)n),'[]');
end;$list$;
revoke all on function apartman_private.request_list() from public,anon,authenticated;
grant execute on function apartman_private.request_list() to authenticated;
create function public.apartman_request_list() returns jsonb language sql stable security invoker set search_path='' as $$select apartman_private.request_list();$$;
revoke all on function public.apartman_request_list() from public,anon,authenticated;
grant execute on function public.apartman_request_list() to authenticated;
do $upgrade$ declare definition text;needle text:='return jsonb_set(result,';begin
 definition:=pg_get_functiondef('apartman_private.backup()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected backup definition';end if;
 definition:=replace(definition,needle,'result := jsonb_set(result,');
 definition:=replace(definition,E'\nend;',E'\n return jsonb_set(result,''{tables}'',(result->''tables'')||jsonb_build_object(''residentRequests'',coalesce((select jsonb_agg(to_jsonb(r)) from public.apartman_requests r),''[]'')));\nend;');
 execute definition;
end;$upgrade$;
notify pgrst,'reload schema';
