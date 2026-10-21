-- Additive upgrade; financial records and existing file permissions stay intact.
-- STEP: tables
create table public.apartman_decisions(
 id integer generated always as identity primary key,
 title text not null check(length(title) between 1 and 150),
 body text not null check(length(body) between 1 and 4000),
 date date not null,
 decision_no text not null default '' check(length(decision_no)<=40),
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.apartman_tasks(
 id integer generated always as identity primary key,
 title text not null check(length(title) between 1 and 150),
 notes text not null default '' check(length(notes)<=2000),
 assignee text not null default '' check(length(assignee)<=100),
 due_date date,
 status text not null default 'pending' check(status in('pending','in_progress','done')),
 decision_id integer references public.apartman_decisions(id) on delete restrict,
 archived boolean not null default false,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default clock_timestamp()
);
create index apartman_tasks_decision_idx on public.apartman_tasks(decision_id);
alter table public.apartman_decisions enable row level security;
alter table public.apartman_tasks enable row level security;
revoke all on public.apartman_decisions,public.apartman_tasks from public,anon,authenticated;
revoke all on sequence public.apartman_decisions_id_seq,public.apartman_tasks_id_seq from public,anon,authenticated;
alter table public.apartman_expense_files alter column expense_id drop not null,
 add column decision_id integer references public.apartman_decisions(id) on delete restrict,
 add constraint apartman_file_one_parent check(num_nonnulls(expense_id,decision_id)=1);
create index apartman_files_decision_idx on public.apartman_expense_files(decision_id);

-- STEP: decision_save
create function apartman_private.decision_save(payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''
as $save$
declare target integer; old public.apartman_decisions%rowtype; day date; new_title text;new_body text;number_text text;
begin
 target:=(payload->>'id')::integer;
 new_title:=btrim(coalesce(payload->>'title',''));new_body:=btrim(coalesce(payload->>'body',''));number_text:=btrim(coalesce(payload->>'decisionNo',''));
 if length(new_title) not between 1 and 150 or length(new_body) not between 1 and 4000 or length(number_text)>40 then raise exception 'Başlık ve karar metnini kontrol edin.';end if;
 if coalesce(payload->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'Geçerli tarih girin.';end if;
 day:=(payload->>'date')::date;
 if target is null then
  insert into public.apartman_decisions(title,body,date,decision_no) values(new_title,new_body,day,number_text) returning id into target;
 else
  select * into old from public.apartman_decisions where id=target for update;
  if not found or payload->>'version' is distinct from old.updated_at::text then raise exception 'Karar değişmiş veya bulunamıyor. Listeyi yenileyin.';end if;
  update public.apartman_decisions set title=new_title,body=new_body,date=day,decision_no=number_text,updated_at=clock_timestamp() where id=target;
 end if;
 insert into public.apartman_audit(action,details) values('Karar kaydedildi',jsonb_build_object('id',target,'title',new_title));
 return jsonb_build_object('ok',true,'id',target);
end;
$save$;
revoke all on function apartman_private.decision_save(jsonb) from public,anon,authenticated;

-- STEP: task_save
create function apartman_private.task_save(payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''
as $save$
declare target integer;old public.apartman_tasks%rowtype;new_title text;new_notes text;person text;day date;new_status text;decision integer;
begin
 target:=(payload->>'id')::integer;new_title:=btrim(coalesce(payload->>'title',''));new_notes:=btrim(coalesce(payload->>'notes',''));person:=btrim(coalesce(payload->>'assignee',''));new_status:=coalesce(payload->>'status','pending');decision:=nullif(payload->>'decisionId','')::integer;
 if length(new_title) not between 1 and 150 or length(new_notes)>2000 or length(person)>100 then raise exception 'İş bilgilerini kontrol edin.';end if;
 if new_status not in('pending','in_progress','done') then raise exception 'Geçerli durum seçin.';end if;
 if nullif(payload->>'dueDate','') is not null then
  if payload->>'dueDate' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'Geçerli hedef tarih girin.';end if;day:=(payload->>'dueDate')::date;
 end if;
 if target is null then
  insert into public.apartman_tasks(title,notes,assignee,due_date,status,decision_id,completed_at) values(new_title,new_notes,person,day,new_status,decision,case when new_status='done' then now() end) returning id into target;
 else
  select * into old from public.apartman_tasks where id=target for update;
  if not found or payload->>'version' is distinct from old.updated_at::text then raise exception 'İş değişmiş veya bulunamıyor. Listeyi yenileyin.';end if;
  update public.apartman_tasks set title=new_title,notes=new_notes,assignee=person,due_date=day,status=new_status,decision_id=decision,completed_at=case when new_status='done' then coalesce(old.completed_at,now()) end,updated_at=clock_timestamp() where id=target;
 end if;
 insert into public.apartman_audit(action,details) values('İş kaydedildi',jsonb_build_object('id',target,'status',new_status,'title',new_title));
 return jsonb_build_object('ok',true,'id',target);
end;
$save$;
revoke all on function apartman_private.task_save(jsonb) from public,anon,authenticated;

-- STEP: archive
create function apartman_private.work_archive(kind text,payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''
as $archive$
declare stamp timestamptz;target integer:=(payload->>'id')::integer;flag boolean;
begin
 if jsonb_typeof(payload->'archived') is distinct from 'boolean' then raise exception 'Arşiv seçimi gerekli.';end if;flag:=(payload->>'archived')::boolean;
 if kind='decision' then
  select updated_at into stamp from public.apartman_decisions where id=target for update;
 else
  select updated_at into stamp from public.apartman_tasks where id=target for update;
 end if;
 if not found or payload->>'version' is distinct from stamp::text then raise exception 'Kayıt değişmiş veya bulunamıyor. Listeyi yenileyin.';end if;
 if kind='decision' then update public.apartman_decisions set archived=flag,updated_at=clock_timestamp() where id=target;
 else update public.apartman_tasks set archived=flag,updated_at=clock_timestamp() where id=target;end if;
 insert into public.apartman_audit(action,details) values('Karar / iş arşivi güncellendi',jsonb_build_object('kind',kind,'id',target,'archived',flag));
 return jsonb_build_object('ok',true);
end;
$archive$;
revoke all on function apartman_private.work_archive(text,jsonb) from public,anon,authenticated;

-- STEP: work_rpc
create function apartman_private.work_manage(kind text,payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $manage$
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if kind is null or kind not in('decision','task') or payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>30000 then raise exception 'Geçersiz istek.';end if;
 perform id from public.apartman_settings where id=1 for update;
 if payload->>'operation'='archive' then return apartman_private.work_archive(kind,payload);
 elsif payload->>'operation'='save' then
  if kind='decision' then return apartman_private.decision_save(payload);else return apartman_private.task_save(payload);end if;
 else raise exception 'Geçersiz işlem.';end if;
end;
$manage$;
revoke all on function apartman_private.work_manage(text,jsonb) from public,anon,authenticated;
grant execute on function apartman_private.work_manage(text,jsonb) to authenticated;
create function public.apartman_work_manage(kind text,payload jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select apartman_private.work_manage(kind,payload);$$;
revoke all on function public.apartman_work_manage(text,jsonb) from public,anon,authenticated;
grant execute on function public.apartman_work_manage(text,jsonb) to authenticated;

-- STEP: files
create function apartman_private.decision_file_reserve(payload jsonb)
returns jsonb language plpgsql volatile security invoker set search_path=''
as $reserve$
declare target integer:=(payload->>'decisionId')::integer;fid uuid:=gen_random_uuid();mime text:=payload->>'mimeType';fname text:=btrim(coalesce(payload->>'fileName',''));n bigint:=(payload->>'bytes')::bigint;ext text;f public.apartman_expense_files%rowtype;
begin
 if not exists(select 1 from public.apartman_decisions where id=target) then raise exception 'Karar bulunamadı.';end if;
 if (select count(*) from public.apartman_expense_files where decision_id=target)>=5 then raise exception 'Bir karara en fazla 5 belge ekleyebilirsiniz.';end if;
 if mime is null or mime not in('image/jpeg','image/png','image/webp','application/pdf') then raise exception 'JPG, PNG, WEBP veya PDF seçin.';end if;
 if n is null or n not between 1 and 10485760 or length(fname) not between 1 and 150 then raise exception 'Dosya adını ve 10 MB boyut sınırını kontrol edin.';end if;
 ext:=case mime when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' else '.pdf' end;
 insert into public.apartman_expense_files(id,decision_id,path,file_name,mime_type,bytes) values(fid,target,'decisions/'||target||'/'||fid||ext,fname,mime,n) returning * into f;
 return jsonb_build_object('ok',true,'file',to_jsonb(f));
end;
$reserve$;
revoke all on function apartman_private.decision_file_reserve(jsonb) from public,anon,authenticated;

-- STEP: state
create function apartman_private.work_state()
returns jsonb language plpgsql stable security definer set search_path=''
as $state$
declare admin boolean:=apartman_private.is_admin();decisions jsonb;tasks jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(d) order by d.date desc,d.id desc),'[]') into decisions from (
  select d.id,d.title,d.body,d.date,d.decision_no,d.archived,d.updated_at::text as version,
   coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'file_name',f.file_name,'bytes',f.bytes,'mime_type',f.mime_type,'path',f.path,'uploaded',f.uploaded,'shared',f.shared) order by f.created_at,f.id) from public.apartman_expense_files f where f.decision_id=d.id and (admin or(f.shared and f.uploaded))),'[]') as files
  from public.apartman_decisions d) d;
 select coalesce(jsonb_agg(to_jsonb(t) order by t.due_date nulls last,t.id),'[]') into tasks from (
  select id,title,notes,assignee,due_date,status,decision_id,archived,completed_at,updated_at::text as version from public.apartman_tasks) t;
 return jsonb_build_object('decisions',decisions,'tasks',tasks);
end;
$state$;
revoke all on function apartman_private.work_state() from public,anon,authenticated;

-- STEP: backup
create function apartman_private.backup()
returns jsonb language plpgsql volatile security definer set search_path=''
as $backup$
declare result jsonb;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 result:=apartman_private.action('backup','{}');
 return jsonb_set(result,'{tables}',(result->'tables')||jsonb_build_object('decisions',coalesce((select jsonb_agg(to_jsonb(d)) from public.apartman_decisions d),'[]'),'tasks',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_tasks t),'[]')));
end;
$backup$;
revoke all on function apartman_private.backup() from public,anon,authenticated;
grant execute on function apartman_private.backup() to authenticated;
create function public.apartman_backup()
returns jsonb language sql volatile security invoker set search_path=''
as $$select apartman_private.backup();$$;
revoke all on function public.apartman_backup() from public,anon,authenticated;
grant execute on function public.apartman_backup() to authenticated;

-- STEP: merge_state
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
  return result || apartman_private.work_state();
end;
$state$;



-- STEP: merge_files
create or replace function apartman_private.expense_manage(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $manage$
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>10000 then raise exception 'Geçersiz istek.';end if;
 perform id from public.apartman_settings where id=1 for update;
 case payload->>'operation'
 when 'update' then return apartman_private.expense_update(payload);
 when 'reserve' then return apartman_private.file_reserve(payload);
 when 'reserve-decision' then return apartman_private.decision_file_reserve(payload);
 when 'complete','visibility','remove' then return apartman_private.file_change(payload);
 else raise exception 'Geçersiz işlem.';
 end case;
end;
$manage$;
revoke all on function apartman_private.expense_manage(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.expense_manage(jsonb) to authenticated;
create or replace function public.apartman_expense_manage(payload jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select apartman_private.expense_manage(payload);$$;
revoke all on function public.apartman_expense_manage(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_expense_manage(jsonb) to authenticated;

notify pgrst,'reload schema';

-- STEP: document_audit
create or replace function apartman_private.file_change(payload jsonb)
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
   insert into public.apartman_audit(action,details) values('Belge eklendi',jsonb_build_object('expenseId',f.expense_id,'decisionId',f.decision_id,'fileId',f.id,'fileName',f.file_name));
  elsif op='visibility' then
   if not f.uploaded then raise exception 'Önce belgeyi yükleyin.';end if;
   if jsonb_typeof(payload->'shared') is distinct from 'boolean' then raise exception 'Görünürlük seçin.';end if;
   visibility:=(payload->>'shared')::boolean;
   update public.apartman_expense_files set shared=visibility where id=f.id;
   insert into public.apartman_audit(action,details) values('Belge görünürlüğü değişti',jsonb_build_object('fileId',f.id,'shared',visibility));
  else
   if exists(select 1 from storage.objects where bucket_id='apartman-expense-files' and name=f.path) then raise exception 'Önce belge dosyasını kaldırın.';end if;
   delete from public.apartman_expense_files where id=f.id;
   insert into public.apartman_audit(action,details) values('Belge kaldırıldı',to_jsonb(f));
  end if;
  return jsonb_build_object('ok',true);
end;
$change$;
revoke all on function apartman_private.file_change(jsonb) from public,anon,authenticated;

