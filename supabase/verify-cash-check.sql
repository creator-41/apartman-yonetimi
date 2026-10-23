begin;
select set_config('test.admin',(select user_id::text from public.apartman_admins limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
do $$
declare initial jsonb;after_state jsonb;view_data jsonb;payload jsonb;r jsonb;record_id uuid:=gen_random_uuid();balance bigint;bad jsonb;i integer;
begin
 initial:=public.apartman_state();view_data:=public.apartman_cash_check_get();balance:=(initial#>>'{totals,cash}')::bigint;
 if (view_data->>'ledgerCash')::bigint<>balance then raise exception 'Ledger mismatch';end if;
 payload:=jsonb_build_object('requestId',record_id,'bank',balance,'cash',0,'expectedCash',balance,'note',' TEST kasa kontrolü ');
 r:=public.apartman_cash_check_save(payload);
 if r#>>'{check,difference}'<>'0' or r#>>'{check,note}'<>'TEST kasa kontrolü' or r#>>'{check,checked_at}' is null then raise exception 'Match not saved';end if;
 if public.apartman_cash_check_save(payload)->>'replayed'<>'true' then raise exception 'Retry not idempotent';end if;
 if (select count(*) from jsonb_array_elements(public.apartman_cash_check_get()->'history') c where c->>'id'=record_id::text)<>1 then raise exception 'Duplicate check';end if;
 begin perform public.apartman_cash_check_save(payload||jsonb_build_object('cash',1));raise exception 'Changed replay accepted' using errcode='ZX001';exception when sqlstate 'ZX001' then raise;when others then null;end;
 r:=public.apartman_cash_check_save(payload||jsonb_build_object('requestId',gen_random_uuid(),'bank',balance+1));
 if r#>>'{check,difference}'<>'1' then raise exception 'Surplus wrong';end if;
 r:=public.apartman_cash_check_save(payload||jsonb_build_object('requestId',gen_random_uuid(),'bank',balance-1));
 if r#>>'{check,difference}'<>'-1' then raise exception 'Deficit wrong';end if;
 for bad in select value from jsonb_array_elements('[{}, {"bank":null}, {"cash":-1}, {"bank":1.1}, {"bank":"100"}, {"cash":1000000001}, {"note":null}]'::jsonb) loop
  begin perform public.apartman_cash_check_save((case when bad='{}' then bad else payload||bad||jsonb_build_object('requestId',gen_random_uuid()) end));raise exception 'Invalid accepted' using errcode='ZX001';exception when sqlstate 'ZX001' then raise;when others then null;end;
 end loop;
 begin perform public.apartman_cash_check_save(payload||jsonb_build_object('requestId',gen_random_uuid(),'expectedCash',balance+1));raise exception 'Stale accepted' using errcode='ZX001';exception when sqlstate 'ZX001' then raise;when others then null;end;
 for i in 1..9 loop perform public.apartman_cash_check_save(payload||jsonb_build_object('requestId',gen_random_uuid()));end loop;
 view_data:=public.apartman_cash_check_get();if jsonb_array_length(view_data->'history')<>10 then raise exception 'History not bounded';end if;
 if jsonb_array_length(apartman_private.backup()->'tables'->'cashChecks')<12 then raise exception 'Backup incomplete';end if;
 after_state:=public.apartman_state();
 if after_state->'totals' is distinct from initial->'totals' or after_state->'settings' is distinct from initial->'settings' or after_state->'charges' is distinct from initial->'charges' or after_state->'payments' is distinct from initial->'payments' or after_state->'expenses' is distinct from initial->'expenses' then raise exception 'Checks changed finance';end if;
 perform apartman_private.action('expense',jsonb_build_object('date','2000-01-02','category','Diğer','description','TEST STALE CHECK '||gen_random_uuid(),'amount',0.01));
 begin perform public.apartman_cash_check_save(payload||jsonb_build_object('requestId',gen_random_uuid()));raise exception 'Real stale cash accepted' using errcode='ZX001';exception when sqlstate 'ZX001' then raise;when others then null;end;
 if public.apartman_cash_check_save(payload)->>'replayed'<>'true' then raise exception 'Saved retry broken by later ledger update';end if;
 if (public.apartman_cash_check_get()->>'ledgerCash')::bigint<>balance-1 then raise exception 'Current cash not refreshed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 begin perform public.apartman_cash_check_get();raise exception 'Nonadmin read allowed';exception when insufficient_privilege then null;end;
 begin perform public.apartman_cash_check_save(payload);raise exception 'Nonadmin save allowed';exception when insufficient_privilege then null;end;
 begin perform * from apartman_private.cash_checks;raise exception 'Direct table access allowed';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.apartman_cash_check_get()','execute') or has_function_privilege('anon','public.apartman_cash_check_save(jsonb)','execute') then raise exception 'Anon allowed';end if;
end $$;
rollback;
