-- Test-only writes are rolled back. No real payment or debt is left behind.
begin;
select set_config('test.apartman_admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.apartman_admin'),true);
do $test$
declare s jsonb; baseline jsonb; u integer; cid integer; p jsonb; failed boolean; expected jsonb;
begin
 s:=public.apartman_state();baseline:=s->'totals';u:=(s#>>'{units,0,id}')::int;
 if exists(select 1 from jsonb_array_elements(s->'charges') c where (c->>'unit_id')::int=u and c->>'period'='2001-01') then raise exception 'Test month contains data'; end if;
 p:=jsonb_build_object('unitId',u,'date','2001-01-15','amount',150,'note','PRIVATE TEST DEBT');
 cid:=(public.apartman_opening_charge(p)->>'id')::int;
 s:=public.apartman_state();
 if (s#>>'{totals,cash}')::bigint<>(baseline->>'cash')::bigint then raise exception 'Debt entry changed cash'; end if;
 if (s#>>'{totals,receivable}')::bigint<>(baseline->>'receivable')::bigint+15000 then raise exception 'Debt total incorrect'; end if;
 if not exists(select 1 from jsonb_array_elements(s->'charges') c where (c->>'id')::int=cid and c->>'kind'='opening' and c->>'note'='PRIVATE TEST DEBT' and c->>'incurred_on'='2001-01-15') then raise exception 'Opening details missing'; end if;
 failed:=false;begin perform public.apartman_opening_charge(p);exception when others then failed:=true;end;if not failed then raise exception 'Duplicate allowed';end if;
 failed:=false;begin perform public.apartman_opening_charge(p||jsonb_build_object('date',to_char(now() at time zone 'Europe/Istanbul','YYYY-MM-DD')));exception when others then failed:=true;end;if not failed then raise exception 'Current month allowed';end if;
 failed:=false;begin perform public.apartman_opening_charge(p||'{"amount":0}'::jsonb);exception when others then failed:=true;end;if not failed then raise exception 'Zero debt allowed';end if;
 failed:=false;begin perform public.apartman_opening_charge(p||'{"date":"2001-02-30"}'::jsonb);exception when others then failed:=true;end;if not failed then raise exception 'Invalid date allowed';end if;
 perform public.apartman_action('payment',jsonb_build_object('chargeId',cid,'amount',40,'date',to_char(now() at time zone 'Europe/Istanbul','YYYY-MM-DD'),'note','PRIVATE TEST PAYMENT'));
 s:=public.apartman_state();
 if (s#>>'{totals,cash}')::bigint<>(baseline->>'cash')::bigint+4000 then raise exception 'Payment cash incorrect';end if;
 if not exists(select 1 from jsonb_array_elements(s->'charges') c where (c->>'id')::int=cid and (c->>'paid')::bigint=4000) then raise exception 'Partial payment missing';end if;
 select jsonb_build_array(jsonb_build_object('id',c->'id','unit_id',c->'unit_id','period',c->'period','amount',c->'amount')) into expected from jsonb_array_elements(s->'charges') c where (c->>'id')::int=cid;
 failed:=false;begin perform public.apartman_manage_charges(jsonb_build_object('operation','delete','ids',jsonb_build_array(cid),'expected',expected));exception when others then failed:=true;end;if not failed then raise exception 'Paid opening debt deleted';end if;
 -- Authenticated non-members get only the resident data and cannot create debt.
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 failed:=false;begin perform public.apartman_opening_charge(p);exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Non-admin created debt';end if;
 s:=public.apartman_state();
 if exists(select 1 from jsonb_array_elements(s->'charges') c where c ? 'note') then raise exception 'Private debt note exposed';end if;
 if exists(select 1 from jsonb_array_elements(s->'payments') payment_row where payment_row ? 'note' or payment_row ? 'created_at') then raise exception 'Private payment note exposed';end if;
 if exists(select 1 from jsonb_array_elements(s->'units') unit_row where unit_row ? 'owner' or unit_row ? 'resident') then raise exception 'Private names exposed';end if;
end;
$test$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $test$
declare failed boolean:=false;s jsonb;
begin
 s:=public.apartman_state();
 if not s ? 'payments' then raise exception 'Resident ledger unavailable';end if;
 begin perform public.apartman_opening_charge('{}');exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Anonymous debt creation allowed';end if;
 failed:=false;begin perform id from public.apartman_charges;exception when insufficient_privilege then failed:=true;end;
 if not failed then raise exception 'Direct table access allowed';end if;
end;
$test$;
rollback;
select 'PASS: opening debt, cash invariance, duplicate/date/amount checks, partial payment, paid deletion protection and private-field/access checks; rolled back' as result;
