-- All changes are rolled back; test does not alter real aidats or payments.
begin;
select set_config('test.apartman_admin',(select user_id::text from public.apartman_admins order by created_at limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.apartman_admin'),true);
do $test$
declare s jsonb; chosen jsonb; expected jsonb; ids jsonb; payload jsonb; r jsonb; failed boolean; cid int; pid int; total_before bigint;
begin
 s:=public.apartman_state();
 if exists(select 1 from jsonb_array_elements(s->'charges') c where c->>'period' in('2097-01','2097-02','2097-03')) then raise exception 'Test dates already contain data'; end if;
 total_before:=(s#>>'{totals,cash}')::bigint;
 perform public.apartman_action('charges','{"period":"2097-01","amount":350}');
 s:=public.apartman_state();
 select jsonb_agg(c order by (c->>'id')::int) into chosen from (select c from jsonb_array_elements(s->'charges') c where c->>'period'='2097-01' order by (c->>'id')::int limit 2) t;
 if jsonb_array_length(chosen)<>2 then raise exception 'At least two nonexempt units needed'; end if;
 select jsonb_agg(c->'id'),jsonb_agg(jsonb_build_object('id',c->'id','unit_id',c->'unit_id','period',c->'period','amount',c->'amount')) into ids,expected from jsonb_array_elements(chosen) c;
 payload:=jsonb_build_object('operation','edit','ids',ids,'expected',expected,'amount',400,'period','2097-02');
 r:=public.apartman_manage_charges(payload);
 if (r->>'count')::int<>2 or (r->>'totalAfter')::bigint<>80000 then raise exception 'Bulk edit failed'; end if;
 failed:=false;
 begin perform public.apartman_manage_charges(payload); exception when others then failed:=true; end;
 if not failed then raise exception 'Stale overwrite was allowed'; end if;
 s:=public.apartman_state();
 select jsonb_agg(jsonb_build_object('id',c->'id','unit_id',c->'unit_id','period',c->'period','amount',c->'amount')) into expected from jsonb_array_elements(s->'charges') c where c->'id' in(select jsonb_array_elements(ids));
 payload:=jsonb_build_object('operation','delete','ids',ids,'expected',expected);
 cid:=(ids->>0)::int;
 perform public.apartman_action('payment',jsonb_build_object('chargeId',cid,'amount',10,'date','2097-02-01'));
 failed:=false;
 begin perform public.apartman_manage_charges(payload); exception when others then failed:=true; end;
 if not failed then raise exception 'Partially paid bulk deletion was allowed'; end if;
 s:=public.apartman_state();
 if (select count(*) from jsonb_array_elements(s->'charges') c where c->'id' in(select jsonb_array_elements(ids)))<>2 then raise exception 'Failed deletion was not atomic'; end if;
 select (p->>'id')::int into pid from jsonb_array_elements(s->'payments') p where (p->>'charge_id')::int=cid;
 perform public.apartman_action('delete-payment',jsonb_build_object('id',pid));
 perform public.apartman_action('charges','{"period":"2097-03","amount":350}');
 failed:=false;
 begin perform public.apartman_manage_charges(payload||'{"operation":"edit","amount":450,"period":"2097-03"}'::jsonb); exception when others then failed:=true; end;
 if not failed then raise exception 'Duplicate target month was allowed'; end if;
 r:=public.apartman_manage_charges(payload);
 if (r->>'count')::int<>2 then raise exception 'Bulk deletion failed'; end if;
 s:=public.apartman_state();
 if exists(select 1 from jsonb_array_elements(s->'charges') c where c->'id' in(select jsonb_array_elements(ids))) then raise exception 'Deleted aidats still visible'; end if;
 if (s#>>'{totals,cash}')::bigint<>total_before then raise exception 'Unpaid deletion changed cash'; end if;
 -- A club/nonmember account cannot call the privileged operation.
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
 failed:=false;
 begin perform public.apartman_manage_charges(payload); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Non-admin operation allowed'; end if;
end;
$test$;
set local role anon;
do $test$
declare failed boolean:=false;
begin
 begin perform public.apartman_manage_charges('{"operation":"delete","ids":[],"expected":[]}'); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Anonymous management allowed'; end if;
end;
$test$;
rollback;
select 'PASS: amount/month edit, stale preview, paid protection, duplicate month, atomic deletion, cash and access; rolled back' as result;
