-- Reversible transaction: no production financial records or stored files are changed.
begin;
select set_config('test.apartman_admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.apartman_admin'),true);
do $test$
declare initial jsonb:=public.apartman_state();s jsonb;h jsonb;e jsonb;unit int;cid int;pid int;eid int;event_id bigint;insert_event bigint;update_event bigint;delete_event bigint;reverse_id bigint;failed bool;day text;file_id uuid;expense_cash bigint;
begin
 unit:=(initial#>>'{units,0,id}')::int;
 select to_char(d,'YYYY-MM-DD') into day from generate_series(date '2000-01-01',date '2001-12-01',interval '1 month') d where not exists(select 1 from jsonb_array_elements(initial->'charges') c where (c->>'unit_id')::int=unit and c->>'period'=to_char(d,'YYYY-MM')) limit 1;
 cid:=(public.apartman_opening_charge(jsonb_build_object('unitId',unit,'date',day,'amount',100,'note','TEST_UNDO_CHARGE'))->>'id')::int;
 -- Payment creation -> undo, including receipt identity and duplicate protection.
 pid:=(public.apartman_action('payment',jsonb_build_object('chargeId',cid,'amount',25,'date',day,'note','TEST_UNDO_PAYMENT'))->>'count')::int;
 select (x->>'id')::bigint into event_id from jsonb_array_elements(public.apartman_change_history()) x where x->>'entity'='payment' and (x->>'record_id')::int=pid and x->>'operation'='INSERT';
 if event_id is null then raise exception 'Payment not journaled';end if;
 if (public.apartman_state()#>>'{totals,cash}')::bigint<>(initial#>>'{totals,cash}')::bigint+2500 then raise exception 'Payment cash failed';end if;
 perform public.apartman_undo(event_id);
 if exists(select 1 from jsonb_array_elements(public.apartman_state()->'payments') p where (p->>'id')::int=pid) then raise exception 'Receipt/payment still exists';end if;
 failed:=false;begin perform public.apartman_undo(event_id);exception when others then failed:=true;end;if not failed then raise exception 'Duplicate undo accepted';end if;
 select (x->>'id')::bigint into reverse_id from jsonb_array_elements(public.apartman_change_history()) x where (x->>'undo_of')::bigint=event_id;
 failed:=false;begin perform public.apartman_undo(reverse_id);exception when others then failed:=true;end;if not failed then raise exception 'Undo compensation reversible';end if;
 -- Restoring a cancelled payment must not overpay after a replacement payment.
 pid:=(public.apartman_action('payment',jsonb_build_object('chargeId',cid,'amount',50,'date',day))->>'count')::int;
 perform public.apartman_action('delete-payment',jsonb_build_object('id',pid));
 select (x->>'id')::bigint into delete_event from jsonb_array_elements(public.apartman_change_history()) x where x->>'entity'='payment' and (x->>'record_id')::int=pid and x->>'operation'='DELETE';
 perform public.apartman_action('payment',jsonb_build_object('chargeId',cid,'amount',100,'date',day));
 select (x->>'id')::bigint into event_id from jsonb_array_elements(public.apartman_change_history()) x where x->>'entity'='payment' and x->>'operation'='INSERT' and x->>'undone_at' is null order by (x->>'id')::bigint desc limit 1;
 failed:=false;begin perform public.apartman_undo(delete_event);exception when others then failed:=true;end;if not failed then raise exception 'Restore overpaid charge';end if;
 perform public.apartman_undo(event_id);perform public.apartman_undo(delete_event);
 if not exists(select 1 from jsonb_array_elements(public.apartman_state()->'payments') p where (p->>'id')::int=pid and (p->>'amount')::int=5000) then raise exception 'Cancelled payment not restored with same identity';end if;
 expense_cash:=(public.apartman_state()#>>'{totals,cash}')::bigint;
 -- Expense update, stale protection, deletion restore and undo original creation.
 eid:=(public.apartman_action('expense',jsonb_build_object('category','Elektrik','description','TEST_UNDO_EXPENSE','amount',20,'date',day))->>'count')::int;
 select (x->>'id')::bigint into insert_event from jsonb_array_elements(public.apartman_change_history()) x where x->>'entity'='expense' and (x->>'record_id')::int=eid and x->>'operation'='INSERT';
 select x into e from jsonb_array_elements(public.apartman_state()->'expenses') x where (x->>'id')::int=eid;
 perform public.apartman_expense_manage(jsonb_build_object('operation','update','expenseId',eid,'expected',jsonb_build_object('category',e->'category','description',e->'description','amount',e->'amount','date',e->'date'),'category','Temizlik','description','TEST_UNDO_EDITED','amount',30,'date',day));
 select (x->>'id')::bigint into update_event from jsonb_array_elements(public.apartman_change_history()) x where x->>'entity'='expense' and (x->>'record_id')::int=eid and x->>'operation'='UPDATE';
 failed:=false;begin perform public.apartman_undo(insert_event);exception when others then failed:=true;end;if not failed then raise exception 'Stale creation undo accepted';end if;
 perform public.apartman_undo(update_event);
 if (public.apartman_state()#>>'{totals,cash}')::bigint<>expense_cash-2000 then raise exception 'Expense edit undo cash wrong';end if;
 perform public.apartman_action('delete-expense',jsonb_build_object('id',eid));
 select (x->>'id')::bigint into delete_event from jsonb_array_elements(public.apartman_change_history()) x where x->>'entity'='expense' and (x->>'record_id')::int=eid and x->>'operation'='DELETE' and x->>'undo_of' is null;
 perform public.apartman_undo(delete_event);perform public.apartman_undo(insert_event);
 if (public.apartman_state()#>>'{totals,cash}')::bigint<>expense_cash then raise exception 'Expense lifecycle cash mismatch';end if;
 -- Attached receipt protection; metadata only, no binary object is written.
 eid:=(public.apartman_action('expense',jsonb_build_object('category','Elektrik','description','TEST_UNDO_FILE','amount',15,'date',day))->>'count')::int;
 select (x->>'id')::bigint into event_id from jsonb_array_elements(public.apartman_change_history()) x where x->>'entity'='expense' and (x->>'record_id')::int=eid and x->>'operation'='INSERT';
 file_id:=(public.apartman_expense_manage(jsonb_build_object('operation','reserve','expenseId',eid,'fileName','test.pdf','mimeType','application/pdf','bytes',120))#>>'{file,id}')::uuid;
 failed:=false;begin perform public.apartman_undo(event_id);exception when others then failed:=true;end;if not failed then raise exception 'Expense with document removed';end if;
 perform public.apartman_expense_manage(jsonb_build_object('operation','remove','fileId',file_id));perform public.apartman_undo(event_id);
 if not(public.apartman_backup()->'tables'?'changes') then raise exception 'History missing in backup';end if;
 h:=public.apartman_change_history();if exists(select 1 from jsonb_array_elements(h) x where coalesce(x->>'actor_label','')='') then raise exception 'Actor missing';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 failed:=false;begin perform public.apartman_undo(event_id);exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Unauthorized undo';end if;
 failed:=false;begin perform public.apartman_change_history();exception when insufficient_privilege then failed:=true;end;if not failed then raise exception 'Private history exposed';end if;
 if public.apartman_state()::text like '%before_row%' then raise exception 'Private snapshots leaked';end if;
end;$test$;
set local role anon;
do $test$ begin
 if has_function_privilege('anon','public.apartman_undo(bigint)','execute') or has_function_privilege('anon','public.apartman_change_history()','execute') then raise exception 'Anonymous history/undo grants';end if;
 if has_table_privilege('authenticated','public.apartman_changes','select') then raise exception 'Direct journal access';end if;
end;$test$;
rollback;
