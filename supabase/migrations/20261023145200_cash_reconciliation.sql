create table apartman_private.cash_checks (
 id uuid primary key,
 checked_at timestamptz not null default clock_timestamp(),
 bank_balance bigint not null check(bank_balance between -1000000000 and 1000000000),
 cash_balance bigint not null check(cash_balance between 0 and 1000000000),
 ledger_cash bigint not null,
 difference bigint generated always as (bank_balance+cash_balance-ledger_cash) stored,
 note text not null default '' check(length(note)<=300)
);
create index cash_checks_recent on apartman_private.cash_checks(checked_at desc,id desc);
alter table apartman_private.cash_checks enable row level security;
revoke all on apartman_private.cash_checks from public,anon,authenticated;
create function apartman_private.cash_check_get() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare balance bigint;history jsonb;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 select s.opening_balance+coalesce((select sum(amount) from public.apartman_payments),0)-coalesce((select sum(amount) from public.apartman_expenses),0) into balance from public.apartman_settings s where id=1;
 select coalesce(jsonb_agg(to_jsonb(c) order by c.checked_at desc,c.id desc),'[]') into history from (select * from apartman_private.cash_checks order by checked_at desc,id desc limit 10) c;
 return jsonb_build_object('ledgerCash',balance,'history',history);
end $$;
create function apartman_private.cash_check_save(payload jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare request_id uuid;bank bigint;cash bigint;balance bigint;memo text;existing apartman_private.cash_checks;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>4000 then raise exception 'Geçersiz kasa kontrolü.';end if;
 if jsonb_typeof(payload->'bank') is distinct from 'number' or jsonb_typeof(payload->'cash') is distinct from 'number' or coalesce(payload->>'bank','') !~ '^-?[0-9]{1,10}$' or coalesce(payload->>'cash','') !~ '^[0-9]{1,10}$' then raise exception 'Banka ve nakit tutarını kontrol edin.';end if;
 bank:=(payload->>'bank')::bigint;cash:=(payload->>'cash')::bigint;request_id:=(payload->>'requestId')::uuid;
 if request_id is null or bank not between -1000000000 and 1000000000 or cash not between 0 and 1000000000 then raise exception 'Tutar veya kontrol kimliği geçersiz.';end if;
 if payload?'note' and jsonb_typeof(payload->'note') is distinct from 'string' then raise exception 'Açıklamayı kontrol edin.';end if;
 memo:=btrim(coalesce(payload->>'note',''));if length(memo)>300 then raise exception 'Açıklama en fazla 300 karakter olmalı.';end if;
 perform id from public.apartman_settings where id=1 for update;
 select * into existing from apartman_private.cash_checks where id=request_id;
 if found then
  if existing.bank_balance<>bank or existing.cash_balance<>cash or existing.note<>memo or payload->'expectedCash' is distinct from to_jsonb(existing.ledger_cash) then raise exception 'Bu kontrol kimliği farklı bilgilerle kaydedilmiş. Yeni kontrol açın.';end if;
  return jsonb_build_object('ok',true,'replayed',true,'check',to_jsonb(existing));
 end if;
 select s.opening_balance+coalesce((select sum(amount) from public.apartman_payments),0)-coalesce((select sum(amount) from public.apartman_expenses),0) into balance from public.apartman_settings s where id=1;
 if payload->'expectedCash' is distinct from to_jsonb(balance) then raise exception 'Uygulamadaki kasa değişti. Formu kapatıp ekranı yenileyin ve tekrar kontrol edin.';end if;
 insert into apartman_private.cash_checks(id,bank_balance,cash_balance,ledger_cash,note) values(request_id,bank,cash,balance,memo) returning * into existing;
 insert into public.apartman_audit(action,details) values('Kasa kontrolü kaydedildi',jsonb_build_object('id',request_id,'bank',bank,'cash',cash,'ledgerCash',balance,'difference',existing.difference));
 return jsonb_build_object('ok',true,'check',to_jsonb(existing));
end $$;
revoke all on function apartman_private.cash_check_get() from public,anon,authenticated;
revoke all on function apartman_private.cash_check_save(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.cash_check_get(),apartman_private.cash_check_save(jsonb) to authenticated;
create function public.apartman_cash_check_get() returns jsonb language sql stable security invoker set search_path='' as $$select apartman_private.cash_check_get();$$;
create function public.apartman_cash_check_save(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.cash_check_save(payload);$$;
revoke all on function public.apartman_cash_check_get() from public,anon,authenticated;
revoke all on function public.apartman_cash_check_save(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_cash_check_get(),public.apartman_cash_check_save(jsonb) to authenticated;
do $$
declare definition text;needle text:='''budgetPlan'',coalesce((select jsonb_agg(to_jsonb(bp)) from apartman_private.budget_plan bp),''[]'')';
begin
 definition:=pg_get_functiondef('apartman_private.backup()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected backup definition';end if;
 execute replace(definition,needle,needle||',''cashChecks'',coalesce((select jsonb_agg(to_jsonb(cc) order by checked_at,id) from apartman_private.cash_checks cc),''[]'')');
end $$;
