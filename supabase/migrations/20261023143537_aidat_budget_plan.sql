create table apartman_private.budget_plan (
 id integer primary key check(id=1),
 version integer not null default 0 check(version>=0),
 items jsonb not null default '[]'::jsonb check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=50),
 updated_at timestamptz not null default now()
);
alter table apartman_private.budget_plan enable row level security;
revoke all on apartman_private.budget_plan from public,anon,authenticated;
insert into apartman_private.budget_plan(id) values(1);
create function apartman_private.budget_get() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 return (select jsonb_build_object('version',version,'items',items,'updatedAt',updated_at) from apartman_private.budget_plan where id=1);
end $$;
create function apartman_private.budget_save(payload jsonb) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare current_plan apartman_private.budget_plan;item jsonb;clean jsonb:='[]';label text;amount bigint;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>25000 then raise exception 'Geçersiz gider planı.';end if;
 if jsonb_typeof(payload->'items') is distinct from 'array' then raise exception 'Gider listesi gerekli.';end if;
 if jsonb_array_length(payload->'items')>50 then raise exception 'En fazla 50 gider planlanabilir.';end if;
 for item in select value from jsonb_array_elements(payload->'items') loop
  if jsonb_typeof(item)<>'object' or jsonb_typeof(item->'label') is distinct from 'string' or jsonb_typeof(item->'amount') is distinct from 'number' then raise exception 'Gider adı ve tutarını kontrol edin.';end if;
  label:=btrim(item->>'label');
  if length(label) not between 1 and 100 or (item->>'amount') !~ '^[0-9]{1,10}$' then raise exception 'Gider adı veya tutarı geçersiz.';end if;
  amount:=(item->>'amount')::bigint;
  if amount not between 1 and 1000000000 then raise exception 'Tutar 0,01–10.000.000 TL arasında olmalı.';end if;
  clean:=clean||jsonb_build_array(jsonb_build_object('label',label,'amount',amount));
 end loop;
 select * into current_plan from apartman_private.budget_plan where id=1 for update;
 if payload->'expectedVersion' is distinct from to_jsonb(current_plan.version) then raise exception 'Plan başka bir ekranda değişti. Formu kapatıp planı yenileyin.';end if;
 if clean is not distinct from current_plan.items then return apartman_private.budget_get();end if;
 update apartman_private.budget_plan set items=clean,version=version+1,updated_at=clock_timestamp() where id=1;
 insert into public.apartman_audit(action,details) values('Aylık gider planı güncellendi',jsonb_build_object('previousItems',current_plan.items,'items',clean,'version',current_plan.version+1));
 return apartman_private.budget_get();
end $$;
revoke all on function apartman_private.budget_get() from public,anon,authenticated;
revoke all on function apartman_private.budget_save(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.budget_get(),apartman_private.budget_save(jsonb) to authenticated;
create function public.apartman_budget_get() returns jsonb language sql stable security invoker set search_path='' as $$select apartman_private.budget_get();$$;
create function public.apartman_budget_save(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.budget_save(payload);$$;
revoke all on function public.apartman_budget_get() from public,anon,authenticated;
revoke all on function public.apartman_budget_save(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_budget_get(),public.apartman_budget_save(jsonb) to authenticated;
-- Keep all existing backup fields and authorization, appending the planning singleton.
do $$
declare definition text;needle text:='''decisionReads'',coalesce((select jsonb_agg(to_jsonb(dr) order by decision_id,unit_id) from apartman_private.decision_reads dr),''[]'')';
begin
 definition:=pg_get_functiondef('apartman_private.backup()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected backup definition';end if;
 execute replace(definition,needle,needle||',''budgetPlan'',coalesce((select jsonb_agg(to_jsonb(bp)) from apartman_private.budget_plan bp),''[]'')');
end $$;
