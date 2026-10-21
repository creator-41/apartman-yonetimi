-- Receipts use a private bucket and the existing apartment administrator list.
create table public.apartman_expense_files (
 id uuid primary key default gen_random_uuid(),
 expense_id integer not null references public.apartman_expenses(id) on delete restrict,
 path text not null unique,
 file_name text not null check(length(file_name) between 1 and 150),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
 bytes bigint not null check(bytes between 1 and 10485760),
 uploaded boolean not null default false,
 shared boolean not null default false,
 created_at timestamptz not null default now()
);
create index apartman_expense_files_expense_idx on public.apartman_expense_files(expense_id);
alter table public.apartman_expense_files enable row level security;
revoke all on public.apartman_expense_files from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('apartman-expense-files','apartman-expense-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']);

create function apartman_private.file_access(object_path text,operation text)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.apartman_expense_files f
 where f.path=object_path and case operation
 when 'read' then apartman_private.is_admin() or (f.uploaded and f.shared)
 when 'upload' then apartman_private.is_admin() and not f.uploaded
 when 'delete' then apartman_private.is_admin()
 else false end);
$$;
revoke all on function apartman_private.file_access(text,text) from public,anon,authenticated;
grant execute on function apartman_private.file_access(text,text) to anon,authenticated;
create policy apartman_files_read on storage.objects for select to anon,authenticated
 using(bucket_id='apartman-expense-files' and apartman_private.file_access(name,'read'));
create policy apartman_files_insert on storage.objects for insert to authenticated
 with check(bucket_id='apartman-expense-files' and apartman_private.file_access(name,'upload'));
create policy apartman_files_delete on storage.objects for delete to authenticated
 using(bucket_id='apartman-expense-files' and apartman_private.file_access(name,'delete'));

create function apartman_private.expense_update(payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''
as $edit$
declare eid integer:=(payload->>'expenseId')::integer; old public.apartman_expenses%rowtype; expected jsonb;n bigint;new_description text;cat text;d date;
begin
 select * into old from public.apartman_expenses where id=eid for update;
 if not found then raise exception 'Gider bulunamadı. Listeyi yenileyin.';end if;

  expected:=jsonb_build_object('category',old.category,'description',old.description,'amount',old.amount,'date',old.date);
  if payload->'expected' is distinct from expected then raise exception 'Bu gider başka bir işlemde değişti. Listeyi yenileyin.';end if;
  n:=apartman_private.money(payload->'amount');
  new_description:=btrim(coalesce(payload->>'description',''));cat:=payload->>'category';
  if length(new_description) not between 1 and 300 then raise exception 'Açıklama girin.';end if;
  if coalesce(payload->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'Geçerli tarih girin.';end if;
  d:=(payload->>'date')::date;
  update public.apartman_expenses set category=cat,description=new_description,amount=n,date=d where id=eid;
  insert into public.apartman_audit(action,details) values('Gider düzenlendi',jsonb_build_object('id',eid,'before',to_jsonb(old),'after',jsonb_build_object('category',cat,'description',new_description,'amount',n,'date',d)));
  return jsonb_build_object('ok',true);
end;
$edit$;
revoke all on function apartman_private.expense_update(jsonb) from public,anon,authenticated;

create function apartman_private.file_reserve(payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''
as $reserve$
declare eid integer:=(payload->>'expenseId')::integer;fid uuid;f public.apartman_expense_files%rowtype;mime text;fname text;n bigint;ext text;
begin
 if not exists(select 1 from public.apartman_expenses where id=eid) then raise exception 'Gider bulunamadı. Listeyi yenileyin.';end if;

  if (select count(*) from public.apartman_expense_files where expense_id=eid)>=5 then raise exception 'Bir gidere en fazla 5 belge ekleyebilirsiniz.';end if;
  mime:=payload->>'mimeType';fname:=btrim(coalesce(payload->>'fileName',''));n:=(payload->>'bytes')::bigint;
  if mime is null or mime not in ('image/jpeg','image/png','image/webp','application/pdf') then raise exception 'JPG, PNG, WEBP veya PDF seçin.';end if;
  if n is null or n not between 1 and 10485760 then raise exception 'Belge en fazla 10 MB olabilir.';end if;
  if length(fname) not between 1 and 150 then raise exception 'Dosya adı 1–150 karakter olmalıdır.';end if;
  fid:=gen_random_uuid();ext:=case mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.pdf' end;
  insert into public.apartman_expense_files(id,expense_id,path,file_name,mime_type,bytes)
   values(fid,eid,eid::text||'/'||fid::text||ext,fname,mime,n) returning * into f;
  return jsonb_build_object('ok',true,'file',to_jsonb(f));
end;
$reserve$;
revoke all on function apartman_private.file_reserve(jsonb) from public,anon,authenticated;

create function apartman_private.file_change(payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''
as $change$
declare op text:=payload->>'operation';f public.apartman_expense_files%rowtype;actual jsonb;visibility boolean;
begin

  select * into f from public.apartman_expense_files where id=(payload->>'fileId')::uuid for update;
  if not found then raise exception 'Belge bulunamadı. Listeyi yenileyin.';end if;
  if op='complete' then
   select metadata into actual from storage.objects where bucket_id='apartman-expense-files' and name=f.path;
   if not found or (actual->>'size')::bigint is distinct from f.bytes or actual->>'mimetype' is distinct from f.mime_type then raise exception 'Belge yüklemesi tamamlanmadı.';end if;
   update public.apartman_expense_files set uploaded=true where id=f.id;
   insert into public.apartman_audit(action,details) values('Gider belgesi eklendi',jsonb_build_object('expenseId',f.expense_id,'fileId',f.id,'fileName',f.file_name));
  elsif op='visibility' then
   if not f.uploaded then raise exception 'Önce belgeyi yükleyin.';end if;
   if jsonb_typeof(payload->'shared') is distinct from 'boolean' then raise exception 'Görünürlük seçin.';end if;
   visibility:=(payload->>'shared')::boolean;
   update public.apartman_expense_files set shared=visibility where id=f.id;
   insert into public.apartman_audit(action,details) values('Gider belgesi görünürlüğü değişti',jsonb_build_object('fileId',f.id,'shared',visibility));
  else
   if exists(select 1 from storage.objects where bucket_id='apartman-expense-files' and name=f.path) then raise exception 'Önce belge dosyasını kaldırın.';end if;
   delete from public.apartman_expense_files where id=f.id;
   insert into public.apartman_audit(action,details) values('Gider belgesi kaldırıldı',to_jsonb(f));
  end if;
  return jsonb_build_object('ok',true);
end;
$change$;
revoke all on function apartman_private.file_change(jsonb) from public,anon,authenticated;

create function apartman_private.expense_manage(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $manage$
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>10000 then raise exception 'Geçersiz istek.';end if;
 perform id from public.apartman_settings where id=1 for update;
 case payload->>'operation'
 when 'update' then return apartman_private.expense_update(payload);
 when 'reserve' then return apartman_private.file_reserve(payload);
 when 'complete','visibility','remove' then return apartman_private.file_change(payload);
 else raise exception 'Geçersiz işlem.';
 end case;
end;
$manage$;
revoke all on function apartman_private.expense_manage(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.expense_manage(jsonb) to authenticated;
create function public.apartman_expense_manage(payload jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select apartman_private.expense_manage(payload);$$;
revoke all on function public.apartman_expense_manage(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_expense_manage(jsonb) to authenticated;
create or replace function apartman_private.state()
returns jsonb language plpgsql stable security definer set search_path=''
as $state$
declare
  admin boolean := apartman_private.is_admin();
  s public.apartman_settings%rowtype;
  units jsonb; charges jsonb; expenses jsonb;
  income bigint; spent bigint; receivable bigint; result jsonb;
begin
  select * into strict s from public.apartman_settings where id=1;
  if admin then
    select coalesce(jsonb_agg(to_jsonb(u) order by u.id),'[]') into units from public.apartman_units u;
  else
    select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'label',u.label,'exempt',u.exempt) order by u.id),'[]') into units from public.apartman_units u;
  end if;
  select coalesce(jsonb_agg((to_jsonb(c) - case when admin then array[]::text[] else array['note']::text[] end) order by c.period desc,c.unit_id),'[]'),coalesce(sum(c.amount-c.paid),0)
    into charges,receivable
    from (select a.*,coalesce((select sum(p.amount) from public.apartman_payments p where p.charge_id=a.id),0)::bigint as paid from public.apartman_charges a) c;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.date desc,e.id desc),'[]'),coalesce(sum(e.amount),0) into expenses,spent from (
    select e.*,coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'file_name',f.file_name,'mime_type',f.mime_type,'bytes',f.bytes,'path',f.path,'uploaded',f.uploaded,'shared',f.shared) order by f.created_at,f.id)
      from public.apartman_expense_files f where f.expense_id=e.id and (admin or (f.shared and f.uploaded))),'[]') as files
    from public.apartman_expenses e) e;
  select coalesce(sum(amount),0) into income from public.apartman_payments;
  result := jsonb_build_object('admin',admin,'settings',jsonb_build_object('name',s.name,'monthlyDues',s.monthly_dues::text,'openingBalance',s.opening_balance::text),
    'units',units,'charges',charges,'expenses',expenses,
    'notices',coalesce((select jsonb_agg(to_jsonb(n) order by n.id desc) from public.apartman_notices n),'[]'),
    'categories',jsonb_build_array('Temizlik','Elektrik','Su','Asansör','Bakım / Onarım','Yönetim gideri','Diğer'),
    'totals',jsonb_build_object('income',income,'expenses',spent,'receivable',receivable,'cash',s.opening_balance+income-spent));
  result := result || jsonb_build_object('payments',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'charge_id',p.charge_id,'amount',p.amount,'date',p.date) order by p.date,p.id) from public.apartman_payments p),'[]'));
  if admin then
    result := result || jsonb_build_object('payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.date desc,p.id desc) from public.apartman_payments p),'[]'),
      'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (select * from public.apartman_audit order by id desc limit 100) a),'[]'));
  end if;
  return result;
end;
$state$;


create or replace function apartman_private.action(action text,payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $action$
declare
  amount bigint; balance bigint; remaining bigint; target integer; counter integer;
  month text; label text; d date; details jsonb; audit_name text;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>20000 then raise exception 'Geçersiz istek.'; end if;
 -- Serialize small apartment writes: exemptions, dues and payment checks stay atomic.
 perform id from public.apartman_settings where id=1 for update;
 if action='backup' then
   return jsonb_build_object('version',2,'exportedAt',now(),'tables',jsonb_build_object(
     'units',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_units t),'[]'),
     'charges',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_charges t),'[]'),
     'payments',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_payments t),'[]'),
     'expenses',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_expenses t),'[]'),
     'expenseFiles',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_expense_files t),'[]'),
     'settings',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_settings t),'[]'),
     'notices',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_notices t),'[]'),
     'audit',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_audit t),'[]')));
 elsif action='settings' then
   label:=btrim(coalesce(payload->>'name',''));
   amount:=apartman_private.money(payload->'monthlyDues');
   balance:=apartman_private.money(payload->'openingBalance',true);
   update public.apartman_settings set name=label,monthly_dues=amount,opening_balance=balance where id=1;
   audit_name:='Ayarlar güncellendi'; details:=jsonb_build_object('name',label,'monthlyDues',amount,'openingBalance',balance);
 elsif action='unit' then
   target:=(payload->>'id')::integer;
   if jsonb_typeof(payload->'exempt') is distinct from 'boolean' then raise exception 'Muafiyet seçimi gerekli.'; end if;
   update public.apartman_units set label=btrim(coalesce(payload->>'label','')),owner=btrim(coalesce(payload->>'owner','')),resident=btrim(coalesce(payload->>'resident','')),exempt=(payload->>'exempt')::boolean where id=target;
   if not found then raise exception 'Bölüm bulunamadı.'; end if;
   audit_name:='Bölüm güncellendi'; details:=jsonb_build_object('id',target,'exempt',payload->'exempt');
 elsif action='charges' then
   month:=payload->>'period';
   if month is null or month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Geçerli ay seçin.'; end if;
   amount:=apartman_private.money(payload->'amount');
   insert into public.apartman_charges(unit_id,period,amount) select id,month,amount from public.apartman_units where not exempt on conflict(unit_id,period) do nothing;
   get diagnostics counter=row_count;
   audit_name:='Aylık aidat oluşturuldu'; details:=jsonb_build_object('period',month,'amount',amount,'count',counter);
 elsif action='payment' then
   target:=(payload->>'chargeId')::integer;
   select c.amount-coalesce((select sum(p.amount) from public.apartman_payments p where p.charge_id=c.id),0) into remaining from public.apartman_charges c where c.id=target for update;
   if not found then raise exception 'Aidat kaydı bulunamadı.'; end if;
   amount:=case when payload->'amount' is null or payload->'amount'='null'::jsonb then remaining else apartman_private.money(payload->'amount') end;
   if amount<=0 or amount>remaining then raise exception 'Ödeme kalan borcu aşamaz.'; end if;
   if coalesce(payload->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Geçerli tarih girin.'; end if;
   d:=(payload->>'date')::date;
   insert into public.apartman_payments(charge_id,amount,date,note) values(target,amount,d,btrim(coalesce(payload->>'note',''))) returning id into counter;
   audit_name:='Ödeme onaylandı'; details:=jsonb_build_object('id',counter,'chargeId',target,'amount',amount);
 elsif action='delete-payment' then
   delete from public.apartman_payments where id=(payload->>'id')::integer returning to_jsonb(apartman_payments) into details;
   if not found then raise exception 'Ödeme bulunamadı.'; end if;
   audit_name:='Ödeme iptal edildi';
 elsif action='expense' then
   amount:=apartman_private.money(payload->'amount');
   if coalesce(payload->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Geçerli tarih girin.'; end if;
   d:=(payload->>'date')::date;
   insert into public.apartman_expenses(category,description,amount,date) values(payload->>'category',btrim(coalesce(payload->>'description','')),amount,d) returning id into counter;
   audit_name:='Gider eklendi'; details:=jsonb_build_object('id',counter,'category',payload->'category','amount',amount);
 elsif action='delete-expense' then
   if exists(select 1 from public.apartman_expense_files where expense_id=(payload->>'id')::integer) then raise exception 'Önce bu giderin belgelerini kaldırın.'; end if;
   delete from public.apartman_expenses where id=(payload->>'id')::integer returning to_jsonb(apartman_expenses) into details;
   if not found then raise exception 'Gider bulunamadı.'; end if;
   audit_name:='Gider silindi';
 elsif action='notice' then
   insert into public.apartman_notices(title,body) values(btrim(coalesce(payload->>'title','')),btrim(coalesce(payload->>'body',''))) returning id into counter;
   audit_name:='Duyuru eklendi'; details:=jsonb_build_object('id',counter);
 elsif action='delete-notice' then
   delete from public.apartman_notices where id=(payload->>'id')::integer returning to_jsonb(apartman_notices) into details;
   if not found then raise exception 'Duyuru bulunamadı.'; end if;
   audit_name:='Duyuru silindi';
 else raise exception 'Geçersiz işlem.';
 end if;
 insert into public.apartman_audit(action,details) values(audit_name,coalesce(details,'{}'));
 return jsonb_build_object('ok',true,'count',counter);
end;
$action$;

notify pgrst,'reload schema';
