-- Additive upgrade: real balances and existing charges are not changed.
-- Keep the RPC-only access model; no table grants or policies are broadened.
alter table public.apartman_charges
  add column kind text not null default 'monthly' check (kind in ('monthly','opening')),
  add column note text not null default '' check (length(note)<=200),
  add column incurred_on date;
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
  select coalesce(jsonb_agg(to_jsonb(e) order by e.date desc,e.id desc),'[]'),coalesce(sum(e.amount),0) into expenses,spent from public.apartman_expenses e;
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

-- Privileged implementation is intentionally outside the exposed Data API schema.
create function apartman_private.opening_charge(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $opening$
declare target integer; d date; month text; amount bigint; cid integer; description text;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501'; end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>4000 then raise exception 'Geçersiz istek.'; end if;
 perform id from public.apartman_settings where id=1 for update;
 target:=(payload->>'unitId')::integer;
 if not exists(select 1 from public.apartman_units where id=target) then raise exception 'Bölüm bulunamadı.'; end if;
 if coalesce(payload->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then raise exception 'Geçerli tarih girin.'; end if;
 d:=(payload->>'date')::date;
 if d>=date_trunc('month',now() at time zone 'Europe/Istanbul')::date then raise exception 'Eski borç için önceki aylardan bir tarih seçin.'; end if;
 month:=to_char(d,'YYYY-MM');
 amount:=apartman_private.money(payload->'amount');
 description:=btrim(coalesce(payload->>'note',''));
 if length(description) not between 3 and 200 then raise exception '3–200 karakterlik açıklama girin.'; end if;
 if exists(select 1 from public.apartman_charges where unit_id=target and period=month) then raise exception 'Bu bölümün seçilen ayda borcu zaten var. Mevcut kaydı kontrol edin.'; end if;
 insert into public.apartman_charges(unit_id,period,amount,kind,note,incurred_on)
 values(target,month,amount,'opening',description,d) returning id into cid;
 insert into public.apartman_audit(action,details) values('Eski borç devralındı',jsonb_build_object('id',cid,'unitId',target,'date',d,'amount',amount,'note',description));
 return jsonb_build_object('ok',true,'id',cid,'period',month);
end;
$opening$;
revoke all on function apartman_private.opening_charge(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.opening_charge(jsonb) to authenticated;
create function public.apartman_opening_charge(payload jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$ select apartman_private.opening_charge(payload); $$;
revoke all on function public.apartman_opening_charge(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_opening_charge(jsonb) to authenticated;
notify pgrst,'reload schema';
