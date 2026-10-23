-- Existing submissions retain their existing permissions and financial behavior.
-- Legacy rows stay untracked: possession of a unit ID never grants notice access.
alter table public.apartman_payment_notices add column tracking_token uuid;
create or replace function apartman_private.notice_submit(payload jsonb)
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
  if old.tracking_token is not null and old.tracking_token is distinct from (payload->>'trackingToken')::uuid then raise exception 'Bildirim doğrulanamadı.';end if;
  if old.request is distinct from canonical then raise exception 'Bildirim daha önce farklı bilgilerle gönderilmiş. Kayıtları kontrol edin.';end if;
  return jsonb_build_object('ok',true,'id',old.id,'status',old.status,'path',old.path,'token',old.upload_token,'uploaded',old.uploaded,'replayed',true);
 end if;
 if not exists(select 1 from public.apartman_units where id=unit) then raise exception 'Daire bulunamadı.';end if;
 select coalesce(sum((x->>'amount')::bigint-(x->>'paid')::bigint),0) into debt from jsonb_array_elements(apartman_private.payment_plan(unit))x;
 if n>debt then raise exception 'Bildirilen tutar dairenin kayıtlı toplam borcunu aşıyor. Yöneticiyle görüşün.';end if;
 if (select count(*) from public.apartman_payment_notices where unit_id=unit and created_at>=date_trunc('day',now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul')>=3 or
    (select count(*) from public.apartman_payment_notices where created_at>=date_trunc('day',now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul')>=30 or
    (select count(*) from public.apartman_payment_notices where status in ('pending','uploading'))>=200 then raise exception 'Bildirim sınırına ulaşıldı. Yöneticiyle görüşün.';end if;
 insert into public.apartman_payment_notices(id,unit_id,amount,date,note,request,status,upload_token,path,file_name,mime_type,bytes,tracking_token)
 values(nid,unit,n,day,note_text,canonical,case when object_path is null then 'pending' else 'uploading' end,token,object_path,fname,mime,size,(payload->>'trackingToken')::uuid) returning * into old;
 return jsonb_build_object('ok',true,'id',old.id,'status',old.status,'path',old.path,'token',old.upload_token,'uploaded',false);
end;$submit$;

create function apartman_private.notice_track(payload jsonb)
returns jsonb language plpgsql stable security definer set search_path=''
as $track$
begin
 if payload is null or jsonb_typeof(payload)<>'array' then raise exception 'Geçersiz takip isteği.';end if;
 if jsonb_array_length(payload)>50 or octet_length(payload::text)>8000 then raise exception 'Takip sınırı aşıldı.';end if;
 return coalesce((
 select jsonb_agg(jsonb_build_object('id',n.id,'unit_id',n.unit_id,'amount',n.amount,'date',n.date,'status',n.status,'created_at',n.created_at,'reviewed_at',n.reviewed_at,'review_note',n.review_note,
 'payments',case when n.status='approved' then coalesce((
  select jsonb_agg(jsonb_build_object('id',(a->>'paymentId')::int,'period',a->>'period','amount',(a->>'amount')::bigint,
   'active',exists(select 1 from public.apartman_payments p join public.apartman_charges c on c.id=p.charge_id where p.id=(a->>'paymentId')::int and c.unit_id=n.unit_id and p.amount=(a->>'amount')::bigint)) order by a->>'period')
  from public.apartman_payment_batches b cross join lateral jsonb_array_elements(b.response->'allocations') a where b.id=n.batch_id
 ),'[]'::jsonb) else '[]'::jsonb end) order by n.created_at desc,n.id)
 from public.apartman_payment_notices n
 where n.tracking_token is not null and exists(
  select 1 from jsonb_array_elements(payload) entry where n.id=(entry->>'id')::uuid and n.tracking_token=(entry->>'token')::uuid
 )
 ),'[]'::jsonb);
end;$track$;
revoke all on function apartman_private.notice_track(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.notice_track(jsonb) to anon,authenticated;
create function public.apartman_notice_track(payload jsonb) returns jsonb language sql stable security invoker set search_path='' as $$select apartman_private.notice_track(payload);$$;
revoke all on function public.apartman_notice_track(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_notice_track(jsonb) to anon,authenticated;
