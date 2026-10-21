-- Synthetic account data is confined to this rolled-back transaction.
begin;
select set_config('test.apartman_admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.apartman_admin'),true);
do $test$
declare initial jsonb:=public.apartman_state();s jsonb;expected jsonb;failed bool;iban text:='TR470000000000000000000000';
begin
 expected:=jsonb_build_object('iban',initial#>>'{settings,iban}','accountHolder',initial#>>'{settings,accountHolder}');
 perform public.apartman_bank_save(jsonb_build_object('iban','tr47 0000 0000 0000 0000 0000 00','accountHolder','TEST_ACCOUNT','expected',expected));
 s:=public.apartman_state();
 if s#>>'{settings,iban}'<>iban or s#>>'{settings,accountHolder}'<>'TEST_ACCOUNT' then raise exception 'Bank save failed';end if;
 if s->'totals' is distinct from initial->'totals' or s->'charges' is distinct from initial->'charges' or s->'payments' is distinct from initial->'payments' then raise exception 'Ledger changed';end if;
 failed:=false;begin perform public.apartman_bank_save(jsonb_build_object('iban',iban,'accountHolder','STALE','expected',expected));exception when others then failed:=true;end;if not failed then raise exception 'Stale bank update accepted';end if;
 expected:=jsonb_build_object('iban',iban,'accountHolder','TEST_ACCOUNT');
 failed:=false;begin perform public.apartman_bank_save(jsonb_build_object('iban','TR000000000000000000000000','accountHolder','TEST_ACCOUNT','expected',expected));exception when others then failed:=true;end;if not failed then raise exception 'Invalid checksum accepted';end if;
 failed:=false;begin perform public.apartman_bank_save(jsonb_build_object('iban',iban,'accountHolder','','expected',expected));exception when others then failed:=true;end;if not failed then raise exception 'Missing holder accepted';end if;
 if not exists(select 1 from jsonb_array_elements(public.apartman_backup()#>'{tables,settings}') x where x->>'iban'=iban) then raise exception 'Bank absent in backup';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 failed:=false;begin perform public.apartman_bank_save(jsonb_build_object('iban','','accountHolder','','expected',expected));exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Nonadmin bank write';end if;
end;$test$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$ begin
 if public.apartman_state()#>>'{settings,iban}'<>'TR470000000000000000000000' then raise exception 'Shared account absent';end if;
 if has_function_privilege('anon','public.apartman_bank_save(jsonb)','execute') then raise exception 'Anonymous mutation grant';end if;
end;$test$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.apartman_admin'),true);
do $test$ begin
 perform public.apartman_bank_save('{"iban":"","accountHolder":"","expected":{"iban":"TR470000000000000000000000","accountHolder":"TEST_ACCOUNT"}}');
 if public.apartman_state()#>>'{settings,iban}'<>'' then raise exception 'Clear failed';end if;
end;$test$;
rollback;
