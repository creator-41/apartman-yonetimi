-- STEP: batches
create table public.apartman_payment_batches(
 id uuid primary key,unit_id integer not null references public.apartman_units(id),
 request jsonb not null,response jsonb not null default '{}',
 actor uuid not null,created_at timestamptz not null default now()
);
create table public.apartman_payment_batch_items(
 batch_id uuid not null references public.apartman_payment_batches(id),
 payment_id integer primary key,
 change_id bigint not null unique references public.apartman_changes(id)
);
create index apartman_payment_batch_items_batch_idx on public.apartman_payment_batch_items(batch_id);
alter table public.apartman_payment_batches enable row level security;
alter table public.apartman_payment_batch_items enable row level security;
revoke all on public.apartman_payment_batches,public.apartman_payment_batch_items from public,anon,authenticated;

-- STEP: plan
create function apartman_private.payment_plan(unit integer)
returns jsonb language sql stable security invoker set search_path=''
as $plan$
 select coalesce(jsonb_agg(to_jsonb(c) order by c.period,c.id),'[]') from (
  select c.id,c.period,c.amount,coalesce((select sum(p.amount) from public.apartman_payments p where p.charge_id=c.id),0)::bigint as paid
  from public.apartman_charges c where c.unit_id=unit)c where c.amount>c.paid;
$plan$;
revoke all on function apartman_private.payment_plan(integer) from public,anon,authenticated;

-- STEP: allocate
create function apartman_private.allocate_payment(batch uuid,plan jsonb,amount bigint,day date,note_text text)
returns jsonb language plpgsql security invoker set search_path=''
as $allocate$
declare charge jsonb;leftover bigint:=amount;part bigint;pid int;change bigint;result jsonb:='[]';
begin
 for charge in select x from jsonb_array_elements(plan) x loop
  exit when leftover=0;part:=least(leftover,(charge->>'amount')::bigint-(charge->>'paid')::bigint);
  insert into public.apartman_payments(charge_id,amount,date,note) values((charge->>'id')::int,part,day,note_text) returning id into pid;
  select id into strict change from public.apartman_changes where entity='payment' and record_id=pid and operation='INSERT' and undo_of is null order by id desc limit 1;
  insert into public.apartman_payment_batch_items(batch_id,payment_id,change_id) values(batch,pid,change);
  result:=result||jsonb_build_array(jsonb_build_object('paymentId',pid,'chargeId',charge->'id','period',charge->'period','amount',part));leftover:=leftover-part;
 end loop;
 if leftover<>0 then raise exception 'Ödeme dağıtımı doğrulanamadı.';end if;
 return result;
end;$allocate$;
revoke all on function apartman_private.allocate_payment(uuid,jsonb,bigint,date,text) from public,anon,authenticated;

-- STEP: pay_rpc
create function apartman_private.pay_unit(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $pay$
declare unit integer;batch uuid;amount bigint;day date;note_text text;plan jsonb;canonical jsonb;old public.apartman_payment_batches%rowtype;allocations jsonb;total bigint;result jsonb;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>150000 then raise exception 'Geçersiz istek.';end if;
 unit:=(payload->>'unitId')::integer;batch:=(payload->>'requestId')::uuid;amount:=apartman_private.money(payload->'amount');note_text:=btrim(coalesce(payload->>'note',''));
 if batch is null or unit is null or length(note_text)>200 or coalesce(payload->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'Ödeme bilgilerini kontrol edin.';end if;day:=(payload->>'date')::date;
 canonical:=jsonb_build_object('unitId',unit,'amount',amount,'date',day,'note',note_text,'expected',payload->'expected');
 perform id from public.apartman_settings where id=1 for update;
 select * into old from public.apartman_payment_batches where id=batch;
 if found then
  if old.request is distinct from canonical then raise exception 'Bu işlem numarası başka bir ödeme için kullanılmış. Listeyi yenileyin.';end if;
  return old.response||jsonb_build_object('replayed',true);
 end if;
 if not exists(select 1 from public.apartman_units where id=unit) then raise exception 'Bölüm bulunamadı.';end if;
 perform id from public.apartman_charges where unit_id=unit order by period,id for update;
 plan:=apartman_private.payment_plan(unit);
 if plan is distinct from payload->'expected' then raise exception 'Dairenin borçları değişmiş. Listeyi yenileyip dağılımı tekrar kontrol edin.';end if;
 select coalesce(sum((x->>'amount')::bigint-(x->>'paid')::bigint),0) into total from jsonb_array_elements(plan)x;
 if amount>total or total=0 then raise exception 'Ödeme toplam kalan borcu aşamaz.';end if;
 insert into public.apartman_payment_batches(id,unit_id,request,actor) values(batch,unit,canonical,auth.uid());
 allocations:=apartman_private.allocate_payment(batch,plan,amount,day,note_text);
 result:=jsonb_build_object('ok',true,'batchId',batch,'unitId',unit,'amount',amount,'date',day,'remaining',total-amount,'allocations',allocations);
 update public.apartman_payment_batches set response=result where id=batch;
 insert into public.apartman_audit(action,details) values('Toplam aidat ödemesi alındı',jsonb_build_object('batchId',batch,'unitId',unit,'amount',amount,'allocations',allocations));
 return result;
end;$pay$;
revoke all on function apartman_private.pay_unit(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.pay_unit(jsonb) to authenticated;
create function public.apartman_pay_unit(payload jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select apartman_private.pay_unit(payload);$$;
revoke all on function public.apartman_pay_unit(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_pay_unit(jsonb) to authenticated;

-- STEP: batch_info
create function apartman_private.payment_batch_info(batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $info$
declare b public.apartman_payment_batches%rowtype;can_undo boolean;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 select * into b from public.apartman_payment_batches where id=batch_id;
 if not found then raise exception 'Ödeme işlemi bulunamadı.';end if;
 select bool_and(c.undone_at is null and p.id is not null) into can_undo from public.apartman_payment_batch_items i join public.apartman_changes c on c.id=i.change_id left join public.apartman_payments p on p.id=i.payment_id where i.batch_id=b.id;
 return b.response||jsonb_build_object('canUndo',coalesce(can_undo,false));
end;$info$;
revoke all on function apartman_private.payment_batch_info(uuid) from public,anon,authenticated;
grant execute on function apartman_private.payment_batch_info(uuid) to authenticated;
create function public.apartman_payment_batch_info(batch_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$select apartman_private.payment_batch_info(batch_id);$$;
revoke all on function public.apartman_payment_batch_info(uuid) from public,anon,authenticated;
grant execute on function public.apartman_payment_batch_info(uuid) to authenticated;

-- STEP: batch_undo
create function apartman_private.undo_payment_batch(batch_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=''
as $undo$
declare item record;found_batch boolean:=false;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 perform id from public.apartman_settings where id=1 for update;
 for item in select i.change_id from public.apartman_payment_batch_items i where i.batch_id=undo_payment_batch.batch_id order by i.change_id desc loop
  found_batch:=true;perform apartman_private.undo_change(item.change_id);
 end loop;
 if not found_batch then raise exception 'Ödeme işlemi bulunamadı.';end if;
 return jsonb_build_object('ok',true);
end;$undo$;
revoke all on function apartman_private.undo_payment_batch(uuid) from public,anon,authenticated;
grant execute on function apartman_private.undo_payment_batch(uuid) to authenticated;
create function public.apartman_undo_payment_batch(batch_id uuid)
returns jsonb language sql volatile security invoker set search_path=''
as $$select apartman_private.undo_payment_batch(batch_id);$$;
revoke all on function public.apartman_undo_payment_batch(uuid) from public,anon,authenticated;
grant execute on function public.apartman_undo_payment_batch(uuid) to authenticated;

-- STEP: history
create or replace function apartman_private.change_history()
returns jsonb language plpgsql stable security definer set search_path=''
as $history$
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(c) order by c.id desc) from (select c.id,c.entity,c.operation,c.record_id,c.before_row,c.after_row,c.actor_label,c.created_at,c.undone_at,c.undone_label,c.undo_of,i.batch_id from public.apartman_changes c left join public.apartman_payment_batch_items i on i.change_id=c.id order by c.id desc limit 100)c),'[]');
end;$history$;

-- STEP: backup
-- Extend the existing backup without changing finance/decision/history exports.
do $upgrade$ declare definition text;needle text:='return jsonb_set(result,';begin
 definition:=pg_get_functiondef('apartman_private.backup()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected backup definition';end if;
 definition:=replace(definition,needle,'result := jsonb_set(result,');
 definition:=replace(definition,E'\nend;',E'\n return jsonb_set(result,''{tables}'',(result->''tables'')||jsonb_build_object(''paymentBatches'',coalesce((select jsonb_agg(to_jsonb(b)) from public.apartman_payment_batches b),''[]''),''paymentBatchItems'',coalesce((select jsonb_agg(to_jsonb(i)) from public.apartman_payment_batch_items i),''[]'')));\nend;');
 execute definition;
end;$upgrade$;
notify pgrst,'reload schema';
