begin;
select set_config('test.admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.admin'),true);
do $$
declare p jsonb;r jsonb;matches jsonb;first_id integer;totals jsonb;expected jsonb;
begin
 p:=jsonb_build_object('operation','create','date','2000-01-02','category','Elektrik','description','TEST DUP IŞIK '||gen_random_uuid(),'amount',12.34);
 r:=public.apartman_expense_save(p);
 if r->>'ok' is distinct from 'true' then raise exception 'First save failed: %',r;end if;
 totals:=public.apartman_state()->'totals';
 r:=public.apartman_expense_save(p||jsonb_build_object('category','Diğer','description',replace(lower(translate(p->>'description','Iİ','ıi')),' ','  ')));
 if r->>'duplicate' is distinct from 'true' or jsonb_array_length(r->'matches')<>1 then raise exception 'Normalized duplicate not found: %',r;end if;
 if public.apartman_state()->'totals' is distinct from totals then raise exception 'Warning changed totals';end if;
 matches:=r->'matches';first_id:=(matches->0->>'id')::integer;
 expected:=jsonb_build_object('date',p->'date','category',p->'category','description',p->'description','amount',1234);
 r:=public.apartman_expense_save(p||jsonb_build_object('operation','update','expenseId',first_id,'expected',expected));
 if r->>'ok' is distinct from 'true' then raise exception 'Edit matched itself: %',r;end if;
 r:=public.apartman_expense_save(p||jsonb_build_object('separateExpense',true,'confirmedMatches',matches));
 if r->>'ok' is distinct from 'true' then raise exception 'Separate expense confirmation failed: %',r;end if;
 totals:=public.apartman_state()->'totals';
 r:=public.apartman_expense_save(p||jsonb_build_object('separateExpense',true,'confirmedMatches',matches));
 if r->>'duplicate' is distinct from 'true' or jsonb_array_length(r->'matches')<>2 then raise exception 'Old confirmation not invalidated';end if;
 if public.apartman_state()->'totals' is distinct from totals then raise exception 'Old confirmation changed totals';end if;
 r:=public.apartman_expense_save(p||jsonb_build_object('operation','update','expenseId',first_id,'expected',expected));
 if jsonb_array_length(r->'matches')<>1 or (r->'matches'->0->>'id')::integer=first_id then raise exception 'Edit did not exclude itself';end if;
 begin
 perform public.apartman_expense_save(p||jsonb_build_object('operation','update','expenseId',first_id,'expected',expected||jsonb_build_object('amount',999),'separateExpense',true,'confirmedMatches',r->'matches'));
 raise exception 'Stale edit accepted' using errcode='ZX001';
 exception when sqlstate 'ZX001' then raise;when others then null;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 begin perform public.apartman_expense_save(p);raise exception 'Nonadmin accepted' using errcode='ZX001';exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.apartman_expense_save(jsonb)','execute') then raise exception 'Anon can execute';end if;
end $$;
rollback;
