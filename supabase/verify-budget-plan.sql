begin;
select set_config('test.admin',(select user_id::text from public.apartman_admins limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
do $$
declare original jsonb;current_plan jsonb;before_state jsonb;after_state jsonb;bad jsonb;
begin
 before_state:=public.apartman_state();original:=public.apartman_budget_get();
 current_plan:=public.apartman_budget_save(jsonb_build_object('expectedVersion',original->'version','items',jsonb_build_array(jsonb_build_object('label',' TEST Temizlik ','amount',300001))));
 if current_plan->'items'->0->>'label'<>'TEST Temizlik' or current_plan->'items'->0->>'amount'<>'300001' then raise exception 'Plan not persisted';end if;
 if (current_plan->>'version')::integer<>(original->>'version')::integer+1 then raise exception 'Version not incremented';end if;
 if public.apartman_budget_get()<>current_plan then raise exception 'Read mismatch';end if;
 if public.apartman_budget_save(jsonb_build_object('expectedVersion',current_plan->'version','items',current_plan->'items'))<>current_plan then raise exception 'Noop changed version';end if;
 begin perform public.apartman_budget_save(jsonb_build_object('expectedVersion',original->'version','items','[]'::jsonb));raise exception 'Stale accepted' using errcode='ZX001';exception when sqlstate 'ZX001' then raise;when others then null;end;
 for bad in select value from jsonb_array_elements('[null,{}, {"items":null}, {"items":[{"label":"","amount":1}]}, {"items":[{"label":"Test","amount":0}]}, {"items":[{"label":"Test","amount":1.1}]}, {"items":[{"label":"Test","amount":"100"}]}]'::jsonb) loop
  begin perform public.apartman_budget_save(coalesce(bad,'null')||jsonb_build_object('expectedVersion',current_plan->'version'));raise exception 'Bad input accepted' using errcode='ZX001';exception when sqlstate 'ZX001' then raise;when others then null;end;
 end loop;
 if public.apartman_budget_get()<>current_plan then raise exception 'Rejected input changed plan';end if;
 if not (apartman_private.backup()->'tables')?'budgetPlan' then raise exception 'Plan missing from backup';end if;
 after_state:=public.apartman_state();
 if after_state->'totals' is distinct from before_state->'totals' or after_state->'settings' is distinct from before_state->'settings' or after_state->'charges' is distinct from before_state->'charges' or after_state->'payments' is distinct from before_state->'payments' or after_state->'expenses' is distinct from before_state->'expenses' then raise exception 'Financial records changed';end if;
 current_plan:=public.apartman_budget_save(jsonb_build_object('expectedVersion',current_plan->'version','items','[]'::jsonb));
 if current_plan->'items'<>'[]'::jsonb then raise exception 'Removal failed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 begin perform public.apartman_budget_get();raise exception 'Nonadmin read allowed';exception when insufficient_privilege then null;end;
 begin perform public.apartman_budget_save('{}');raise exception 'Nonadmin save allowed';exception when insufficient_privilege then null;end;
 begin perform * from apartman_private.budget_plan;raise exception 'Direct access allowed';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.apartman_budget_get()','execute') or has_function_privilege('anon','public.apartman_budget_save(jsonb)','execute') then raise exception 'Anonymous access allowed';end if;
end $$;
rollback;
