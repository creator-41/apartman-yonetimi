-- Additive upgrade: no existing charge or payment is changed by installation.
create or replace function apartman_private.manage_charges(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $body$
declare
 ids integer[]; before_rows jsonb; expected_rows jsonb; new_amount bigint;
 operation text; target_period text; source_period text; count_rows integer;
 total_before bigint; audit_id integer;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>200000 then raise exception 'Geçersiz istek.'; end if;
 operation:=payload->>'operation';
 if operation is null or operation not in ('edit','delete') then raise exception 'Geçersiz aidat işlemi.'; end if;
 if jsonb_typeof(payload->'ids') is distinct from 'array' or jsonb_typeof(payload->'expected') is distinct from 'array' then raise exception 'Aidat seçimi ve güncel kayıt bilgisi gerekli.'; end if;
 if jsonb_array_length(payload->'ids') not between 1 and 1000 then raise exception '1 ile 1000 arasında aidat seçin.'; end if;
 select array_agg(v::integer order by v::integer) into ids from jsonb_array_elements_text(payload->'ids') v;
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'Aynı aidat iki kez seçilemez.'; end if;
 -- Same mutex as payments and monthly charge creation: no race with payment approval.
 perform id from public.apartman_settings where id=1 for update;
 perform id from public.apartman_charges where id=any(ids) order by id for update;
 select count(*),min(period),sum(c.amount),jsonb_agg(to_jsonb(c) order by c.id)
   into count_rows,source_period,total_before,before_rows from public.apartman_charges c where id=any(ids);
 if count_rows<>cardinality(ids) then raise exception 'Bazı aidatlar değişmiş veya silinmiş. Listeyi yenileyip tekrar seçin.'; end if;
 if (select count(distinct period) from public.apartman_charges where id=any(ids))<>1 then raise exception 'Tek bir ayın aidatlarını seçin.'; end if;
 if exists(select 1 from public.apartman_payments where charge_id=any(ids)) then raise exception 'Seçimde ödeme girilmiş aidat var. Önce ilgili ödeme kayıtlarını kontrol edip gerekiyorsa iptal edin.'; end if;
 select jsonb_agg(jsonb_build_object('id',c.id,'unit_id',c.unit_id,'period',c.period,'amount',c.amount) order by c.id)
   into expected_rows from public.apartman_charges c where id=any(ids);
 if expected_rows is distinct from (select jsonb_agg(v order by (v->>'id')::integer) from jsonb_array_elements(payload->'expected') v) then
   raise exception 'Aidat bilgileri işlem sırasında değişmiş. Listeyi yenileyip tekrar deneyin.';
 end if;
 if operation='edit' then
   new_amount:=apartman_private.money(payload->'amount');
   target_period:=payload->>'period';
   if target_period is null or target_period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then raise exception 'Geçerli ay seçin.'; end if;
   if exists(select 1 from public.apartman_charges selected join public.apartman_charges other on other.unit_id=selected.unit_id and other.period=target_period and other.id<>all(ids) where selected.id=any(ids)) then
     raise exception 'Hedef ayda bu bölümlerden biri için zaten aidat var. Çift aidat oluşturulamaz.';
   end if;
   update public.apartman_charges set amount=new_amount,period=target_period where id=any(ids);
 else
   delete from public.apartman_charges where id=any(ids);
 end if;
 insert into public.apartman_audit(action,details) values(
   case when operation='edit' then 'Aidatlar düzenlendi' else 'Aidatlar silindi' end,
   jsonb_build_object('operation',operation,'count',count_rows,'period',source_period,'before',before_rows,'newPeriod',target_period,'newAmount',new_amount)
 ) returning id into audit_id;
 return jsonb_build_object('ok',true,'count',count_rows,'totalBefore',total_before,'totalAfter',case when operation='edit' then new_amount*count_rows else 0 end,'auditId',audit_id);
end;
$body$;
revoke all on function apartman_private.manage_charges(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.manage_charges(jsonb) to authenticated;

create or replace function public.apartman_manage_charges(payload jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$ select apartman_private.manage_charges(payload); $$;
revoke all on function public.apartman_manage_charges(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_manage_charges(jsonb) to authenticated;
notify pgrst,'reload schema';
