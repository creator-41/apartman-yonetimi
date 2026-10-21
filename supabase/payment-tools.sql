-- STEP: bank_columns
alter table public.apartman_settings add column iban text not null default '',add column account_holder text not null default '';
alter table public.apartman_settings add constraint apartman_iban_format check(iban='' or iban ~ '^TR[0-9]{24}$'),add constraint apartman_account_holder_length check(length(account_holder)<=100);

-- STEP: bank_rpc
create function apartman_private.bank_save(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $bank$
declare bank_iban text;holder text;s public.apartman_settings%rowtype;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>3000 then raise exception 'Geçersiz istek.';end if;
 select * into strict s from public.apartman_settings where id=1 for update;
 if payload#>>'{expected,iban}' is distinct from s.iban or payload#>>'{expected,accountHolder}' is distinct from s.account_holder then raise exception 'Hesap bilgileri değişmiş. Sayfayı yenileyin.';end if;
 bank_iban:=upper(regexp_replace(coalesce(payload->>'iban',''),'\s','','g'));holder:=btrim(coalesce(payload->>'accountHolder',''));
 if length(holder)>100 then raise exception 'Hesap sahibi en fazla 100 karakter olabilir.';end if;
 if bank_iban<>'' then
  if bank_iban !~ '^TR[0-9]{24}$' then raise exception 'Geçerli bir Türkiye IBAN numarası girin.';end if;
  if mod((substring(bank_iban from 5)||'2927'||substring(bank_iban from 3 for 2))::numeric,97)<>1 then raise exception 'IBAN kontrolü başarısız. Numarayı kontrol edin.';end if;
  if holder='' then raise exception 'Hesap sahibini girin.';end if;
 end if;
 update public.apartman_settings set iban=bank_iban,account_holder=holder where id=1;
 insert into public.apartman_audit(action,details) values('Ödeme hesabı güncellendi',jsonb_build_object('configured',bank_iban<>''));
 return jsonb_build_object('ok',true);
end;$bank$;
revoke all on function apartman_private.bank_save(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.bank_save(jsonb) to authenticated;
create function public.apartman_bank_save(payload jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $$select apartman_private.bank_save(payload);$$;
revoke all on function public.apartman_bank_save(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_bank_save(jsonb) to authenticated;

-- STEP: bank_state
-- Keep the existing ledger and task fields intact, extending only shared payment settings.
do $upgrade$
declare definition text;needle text:='''openingBalance'',s.opening_balance::text)';
begin
 definition:=pg_get_functiondef('apartman_private.state()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected state definition';end if;
 definition:=replace(definition,needle,'''openingBalance'',s.opening_balance::text,''iban'',s.iban,''accountHolder'',s.account_holder)');
 execute definition;
end;$upgrade$;
notify pgrst,'reload schema';
