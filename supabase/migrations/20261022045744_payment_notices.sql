-- STEP: tables
create table public.apartman_payment_notices (
 id uuid primary key,
 unit_id integer not null references public.apartman_units(id),
 amount bigint not null check(amount between 1 and 1000000000),
 date date not null,
 note text not null default '' check(length(note)<=200),
 request jsonb not null,
 status text not null check(status in ('uploading','pending','approved','rejected')),
 upload_token uuid not null default gen_random_uuid(),
 path text unique,file_name text,mime_type text,bytes bigint,
 uploaded boolean not null default false,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,reviewed_by uuid,review_note text,
 batch_id uuid references public.apartman_payment_batches(id)
);
create index apartman_payment_notices_unit_date_idx on public.apartman_payment_notices(unit_id,created_at);
create index apartman_payment_notices_status_date_idx on public.apartman_payment_notices(status,created_at desc);
create index apartman_payment_notices_batch_idx on public.apartman_payment_notices(batch_id);
alter table public.apartman_payment_notices enable row level security;
revoke all on public.apartman_payment_notices from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('apartman-payment-notices','apartman-payment-notices',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']);

-- STEP: storage
create function apartman_private.notice_file_access(object_path text,operation text)
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.apartman_payment_notices n where n.path=object_path and case operation
 when 'read' then apartman_private.is_admin()
 when 'upload' then n.status='uploading' and not n.uploaded and n.created_at>now()-interval '30 minutes'
 else false end);$$;
revoke all on function apartman_private.notice_file_access(text,text) from public,anon,authenticated;
grant execute on function apartman_private.notice_file_access(text,text) to anon,authenticated;
create policy apartman_notice_files_insert on storage.objects for insert to anon,authenticated
 with check(bucket_id='apartman-payment-notices' and apartman_private.notice_file_access(name,'upload'));
create policy apartman_notice_files_read on storage.objects for select to authenticated
 using(bucket_id='apartman-payment-notices' and apartman_private.notice_file_access(name,'read'));

-- STEP: submit
create function apartman_private.notice_submit(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $submit$
declare nid uuid;unit integer;n bigint;day date;note_text text;f jsonb;canonical jsonb;old public.apartman_payment_notices%rowtype;fname text;mime text;size bigint;ext text;object_path text;token uuid:=gen_random_uuid();debt bigint;today date:=(now() at time zone 'Europe/Istanbul')::date;
begin
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>4000 then raise exception 'Geçersiz bildirim.';end if;
 nid:=(payload->>'requestId')::uuid;unit:=(payload->>'unitId')::integer;n:=apartman_private.money(payload->'amount');note_text:=btrim(coalesce(payload->>'note',''));f:=payload->'file';
 if nid is null or unit is null or length(note_text)>200 or coalesce(payload->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'Bildirim bilgilerini kontrol edin.';end if;
 day:=(payload->>'date')::date;if day>today then raise exception 'Ödeme tarihi gelecekte olamaz.';end if;
 if f is not null and f<>'null'::jsonb then
  if jsonb_typeof(f)<>'object' then raise exception 'Geçersiz dekont.';end if;
  fname:=btrim(coalesce(f->>'fileName',''));mime:=f->>'mimeType';size:=(f->>'bytes')::bigint;
  if length(fname) not between 1 and 150 or mime is null or mime not in ('image/jpeg','image/png','image/webp','application/pdf') or size is null or size not between 1 and 5242880 then raise exception 'Dekont JPG, PNG, WEBP veya PDF ve en fazla 5 MB olmalıdır.';end if;
  ext:=case mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.pdf' end;
  object_path:=nid::text||'/'||token::text||ext;
 end if;
 canonical:=jsonb_build_object('unitId',unit,'amount',n,'date',day,'note',note_text,'file',case when object_path is null then null else jsonb_build_object('fileName',fname,'mimeType',mime,'bytes',size) end);
 perform id from public.apartman_settings where id=1 for update;
 select * into old from public.apartman_payment_notices where id=nid;
 if found then
  if old.request is distinct from canonical then raise exception 'Bildirim daha önce farklı bilgilerle gönderilmiş. Kayıtları kontrol edin.';end if;
  return jsonb_build_object('ok',true,'id',old.id,'status',old.status,'path',old.path,'token',old.upload_token,'uploaded',old.uploaded,'replayed',true);
 end if;
 if not exists(select 1 from public.apartman_units where id=unit) then raise exception 'Daire bulunamadı.';end if;
 select coalesce(sum((x->>'amount')::bigint-(x->>'paid')::bigint),0) into debt from jsonb_array_elements(apartman_private.payment_plan(unit))x;
 if n>debt then raise exception 'Bildirilen tutar dairenin kayıtlı toplam borcunu aşıyor. Yöneticiyle görüşün.';end if;
 if (select count(*) from public.apartman_payment_notices where unit_id=unit and created_at>=date_trunc('day',now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul')>=3 or
    (select count(*) from public.apartman_payment_notices where created_at>=date_trunc('day',now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul')>=30 or
    (select count(*) from public.apartman_payment_notices where status in ('pending','uploading'))>=200 then raise exception 'Bildirim sınırına ulaşıldı. Yöneticiyle görüşün.';end if;
 insert into public.apartman_payment_notices(id,unit_id,amount,date,note,request,status,upload_token,path,file_name,mime_type,bytes)
 values(nid,unit,n,day,note_text,canonical,case when object_path is null then 'pending' else 'uploading' end,token,object_path,fname,mime,size) returning * into old;
 return jsonb_build_object('ok',true,'id',old.id,'status',old.status,'path',old.path,'token',old.upload_token,'uploaded',false);
end;$submit$;
revoke all on function apartman_private.notice_submit(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.notice_submit(jsonb) to anon,authenticated;
create function public.apartman_notice_submit(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.notice_submit(payload);$$;
revoke all on function public.apartman_notice_submit(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_notice_submit(jsonb) to anon,authenticated;

-- STEP: complete
create function apartman_private.notice_complete(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $complete$
declare n public.apartman_payment_notices%rowtype;actual jsonb;
begin
 if payload is null or octet_length(payload::text)>1000 then raise exception 'Geçersiz istek.';end if;
 select * into n from public.apartman_payment_notices where id=(payload->>'id')::uuid and upload_token=(payload->>'token')::uuid for update;
 if not found then raise exception 'Bildirim bulunamadı.';end if;
 if n.status<>'uploading' then return jsonb_build_object('ok',true,'id',n.id,'status',n.status);end if;
 if n.created_at<=now()-interval '30 minutes' then raise exception 'Yükleme süresi dolmuş. Yöneticiyle görüşün.';end if;
 select metadata into actual from storage.objects where bucket_id='apartman-payment-notices' and name=n.path;
 if not found or (actual->>'size')::bigint is distinct from n.bytes or actual->>'mimetype' is distinct from n.mime_type then raise exception 'Dekont yüklemesi tamamlanmadı. Aynı formdan tekrar deneyin.';end if;
 update public.apartman_payment_notices set status='pending',uploaded=true where id=n.id;
 return jsonb_build_object('ok',true,'id',n.id,'status','pending');
end;$complete$;
revoke all on function apartman_private.notice_complete(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.notice_complete(jsonb) to anon,authenticated;
create function public.apartman_notice_complete(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.notice_complete(payload);$$;
revoke all on function public.apartman_notice_complete(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_notice_complete(jsonb) to anon,authenticated;

-- STEP: review
create function apartman_private.notice_review(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $review$
declare n public.apartman_payment_notices%rowtype;result jsonb;review_text text:=btrim(coalesce(payload->>'note',''));
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or octet_length(payload::text)>150000 or length(review_text)>200 then raise exception 'Geçersiz istek.';end if;
 perform id from public.apartman_settings where id=1 for update;
 select * into n from public.apartman_payment_notices where id=(payload->>'id')::uuid for update;
 if not found then raise exception 'Bildirim bulunamadı.';end if;
 if n.status='approved' and payload->>'operation'='approve' then return jsonb_build_object('ok',true,'replayed',true,'group',apartman_private.payment_batch_info(n.batch_id));end if;
 if n.status='rejected' and payload->>'operation'='reject' then return jsonb_build_object('ok',true,'replayed',true);end if;
 if n.status not in ('pending','uploading') then raise exception 'Bu bildirim daha önce işlenmiş. Listeyi yenileyin.';end if;
 if payload->>'operation'='approve' then
  if n.status<>'pending' then raise exception 'Dekont yüklemesi tamamlanmamış; bildirim henüz onaylanamaz.';end if;
  if payload->'confirmed' is distinct from 'true'::jsonb then raise exception 'Banka hesabındaki ödemeyi ve daha önce kaydedilmediğini kontrol edin.';end if;
  result:=apartman_private.pay_unit(jsonb_build_object('unitId',n.unit_id,'requestId',n.id,'amount',n.amount::numeric/100,'date',n.date,'note','Bildirim '||left(n.id::text,8)||case when n.note='' then '' else ' · '||left(n.note,170) end,'expected',payload->'expected'));
  update public.apartman_payment_notices set status='approved',batch_id=n.id,reviewed_at=now(),reviewed_by=auth.uid(),review_note=review_text where id=n.id;
 else
  if payload->>'operation' is distinct from 'reject' then raise exception 'Geçersiz işlem.';end if;
  update public.apartman_payment_notices set status='rejected',reviewed_at=now(),reviewed_by=auth.uid(),review_note=review_text where id=n.id;
 end if;
 insert into public.apartman_audit(action,details) values(case when payload->>'operation'='approve' then 'Ödeme bildirimi onaylandı' else 'Ödeme bildirimi reddedildi' end,jsonb_build_object('id',n.id,'unitId',n.unit_id,'amount',n.amount,'note',review_text));
 return jsonb_build_object('ok',true,'group',result);
end;$review$;
revoke all on function apartman_private.notice_review(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.notice_review(jsonb) to authenticated;
create function public.apartman_notice_review(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.notice_review(payload);$$;
revoke all on function public.apartman_notice_review(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_notice_review(jsonb) to authenticated;

-- STEP: list_backup
create function apartman_private.notice_list()
returns jsonb language plpgsql stable security definer set search_path=''
as $list$
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(n) order by n.waiting desc,n.created_at desc) from (
 select id,unit_id,amount,date,note,status,path,file_name,uploaded,created_at,reviewed_at,review_note,batch_id,status in ('pending','uploading') as waiting
 from public.apartman_payment_notices order by (status in ('pending','uploading')) desc,created_at desc limit 300)n),'[]');
end;$list$;
revoke all on function apartman_private.notice_list() from public,anon,authenticated;
grant execute on function apartman_private.notice_list() to authenticated;
create function public.apartman_notice_list() returns jsonb language sql stable security invoker set search_path='' as $$select apartman_private.notice_list();$$;
revoke all on function public.apartman_notice_list() from public,anon,authenticated;
grant execute on function public.apartman_notice_list() to authenticated;
create or replace function apartman_private.backup()
returns jsonb language plpgsql volatile security definer set search_path=''
as $backup$
declare result jsonb;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 result:=apartman_private.action('backup','{}');
 return jsonb_set(result,'{tables}',(result->'tables')||jsonb_build_object(
 'decisions',coalesce((select jsonb_agg(to_jsonb(d)) from public.apartman_decisions d),'[]'),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_tasks t),'[]'),
 'changes',coalesce((select jsonb_agg(to_jsonb(c) order by id) from public.apartman_changes c),'[]'),
 'paymentBatches',coalesce((select jsonb_agg(to_jsonb(b)) from public.apartman_payment_batches b),'[]'),
 'paymentBatchItems',coalesce((select jsonb_agg(to_jsonb(i)) from public.apartman_payment_batch_items i),'[]'),
 'paymentNotices',coalesce((select jsonb_agg(to_jsonb(n)) from public.apartman_payment_notices n),'[]')));
end;$backup$;
notify pgrst,'reload schema';
