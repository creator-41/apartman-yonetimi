-- Synthetic financial entries only; the complete transaction is rolled back.
begin;
select set_config('test.apartman_admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.apartman_admin'),true);
do $test$
declare initial jsonb:=public.apartman_state();s jsonb;plan jsonb;payload jsonb;r jsonb;again jsonb;b jsonb;h jsonb;unit int;cid int;ids int[]:='{}';day text;d record;pid int;event_id bigint;cash bigint;debt bigint;failed bool;batch uuid:=gen_random_uuid();total bigint;
begin
 unit:=(initial#>>'{units,0,id}')::int;
 for d in select x from generate_series(date '2000-01-01',date '2001-12-01',interval '1 month') x where not exists(select 1 from jsonb_array_elements(initial->'charges') c where (c->>'unit_id')::int=unit and c->>'period'=to_char(x,'YYYY-MM')) order by x limit 3 loop
  day:=to_char(d.x,'YYYY-MM-DD');
  cid:=(public.apartman_opening_charge(jsonb_build_object('unitId',unit,'date',day,'amount',100,'note','TEST_OLDEST_FIRST'))->>'id')::int;ids:=array_append(ids,cid);
 end loop;
 if array_length(ids,1)<>3 then raise exception 'Test periods unavailable';end if;
 perform public.apartman_action('payment',jsonb_build_object('chargeId',ids[1],'amount',25,'date',day));
 s:=public.apartman_state();cash:=(s#>>'{totals,cash}')::bigint;debt:=(s#>>'{totals,receivable}')::bigint;
 select jsonb_agg(jsonb_build_object('id',c->'id','period',c->'period','amount',c->'amount','paid',c->'paid') order by c->>'period',(c->>'id')::int) into plan from jsonb_array_elements(s->'charges') c where (c->>'unit_id')::int=unit and (c->>'amount')::bigint>(c->>'paid')::bigint;
 payload:=jsonb_build_object('unitId',unit,'requestId',batch,'amount',125.01,'date',day,'note','TEST_GROUP','expected',plan);
 r:=public.apartman_pay_unit(payload);
 if jsonb_array_length(r->'allocations')<>2 or (r#>>'{allocations,0,chargeId}')::int<>ids[1] or (r#>>'{allocations,0,amount}')::bigint<>7500 or (r#>>'{allocations,1,chargeId}')::int<>ids[2] or (r#>>'{allocations,1,amount}')::bigint<>5001 then raise exception 'Oldest-first allocation wrong';end if;
 s:=public.apartman_state();
 if (s#>>'{totals,cash}')::bigint<>cash+12501 or (s#>>'{totals,receivable}')::bigint<>debt-12501 then raise exception 'Totals wrong';end if;
 again:=public.apartman_pay_unit(payload);
 if again->>'replayed'<>'true' or again->'allocations'<>r->'allocations' or (public.apartman_state()#>>'{totals,cash}')::bigint<>cash+12501 then raise exception 'Retry duplicated payment';end if;
 failed:=false;begin perform public.apartman_pay_unit(payload||jsonb_build_object('amount',125));exception when others then failed:=true;end;if not failed then raise exception 'Changed retry accepted';end if;
 failed:=false;begin perform public.apartman_pay_unit(payload||jsonb_build_object('requestId',gen_random_uuid()));exception when others then failed:=true;end;if not failed then raise exception 'Stale plan accepted';end if;
 b:=public.apartman_payment_batch_info(batch);if b->>'canUndo'<>'true' then raise exception 'Group cannot undo';end if;
 h:=public.apartman_change_history();
 if (select count(*) from jsonb_array_elements(h)x where x->>'batch_id'=batch::text)<>2 then raise exception 'History group missing';end if;
 b:=public.apartman_backup();if not(b->'tables'?'paymentBatches') or not(b->'tables'?'paymentBatchItems') then raise exception 'Backup group missing';end if;
 perform public.apartman_undo_payment_batch(batch);
 if (public.apartman_state()#>>'{totals,cash}')::bigint<>cash or (public.apartman_state()#>>'{totals,receivable}')::bigint<>debt then raise exception 'Undo totals wrong';end if;
 failed:=false;begin perform public.apartman_undo_payment_batch(batch);exception when others then failed:=true;end;if not failed then raise exception 'Duplicate group undo accepted';end if;
 -- A partially cancelled group must fail atomically, even after undoing a later item.
 batch:=gen_random_uuid();payload:=payload||jsonb_build_object('requestId',batch);r:=public.apartman_pay_unit(payload);
 pid:=(r#>>'{allocations,0,paymentId}')::int;
 perform public.apartman_action('delete-payment',jsonb_build_object('id',pid));
 select (x->>'id')::bigint into event_id from jsonb_array_elements(public.apartman_change_history())x where x->>'entity'='payment' and (x->>'record_id')::int=pid and x->>'operation'='DELETE' and x->>'undo_of' is null;
 s:=public.apartman_state();
 failed:=false;begin perform public.apartman_undo_payment_batch(batch);exception when others then failed:=true;end;if not failed then raise exception 'Cancelled group accepted';end if;
 if public.apartman_state()->'payments'<>s->'payments' or public.apartman_state()->'totals'<>s->'totals' then raise exception 'Failed group undo changed records';end if;
 perform public.apartman_undo(event_id);perform public.apartman_undo_payment_batch(batch);
 if (public.apartman_state()#>>'{totals,cash}')::bigint<>cash then raise exception 'Restored group undo wrong';end if;
 select sum((x->>'amount')::bigint-(x->>'paid')::bigint) into total from jsonb_array_elements(plan)x;
 failed:=false;begin perform public.apartman_pay_unit(payload||jsonb_build_object('requestId',gen_random_uuid(),'amount',(total+1)::numeric/100));exception when others then failed:=true;end;if not failed then raise exception 'Overpayment accepted';end if;
 failed:=false;begin perform public.apartman_pay_unit(payload||jsonb_build_object('requestId',gen_random_uuid(),'amount',0));exception when others then failed:=true;end;if not failed then raise exception 'Zero payment accepted';end if;
 failed:=false;begin perform public.apartman_pay_unit(payload||jsonb_build_object('requestId',gen_random_uuid(),'date','2026-02-30'));exception when others then failed:=true;end;if not failed then raise exception 'Invalid date accepted';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 failed:=false;begin perform public.apartman_pay_unit(payload);exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Unauthorized payment';end if;
 failed:=false;begin perform public.apartman_payment_batch_info(batch);exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Unauthorized group read';end if;
 failed:=false;begin perform public.apartman_undo_payment_batch(batch);exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Unauthorized group undo';end if;
 if public.apartman_state()::text like '%TEST_GROUP%' then raise exception 'Private payment note leaked';end if;
end;$test$;
set local role anon;
do $test$ begin
 if has_function_privilege('anon','public.apartman_pay_unit(jsonb)','execute') or has_function_privilege('anon','public.apartman_payment_batch_info(uuid)','execute') or has_function_privilege('anon','public.apartman_undo_payment_batch(uuid)','execute') then raise exception 'Anonymous write grant';end if;
 if has_table_privilege('authenticated','public.apartman_payment_batches','select') or has_table_privilege('authenticated','public.apartman_payment_batch_items','select') then raise exception 'Direct group read grant';end if;
end;$test$;
rollback;
