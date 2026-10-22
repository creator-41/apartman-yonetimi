-- A unit's voluntary declaration, not identity verification or a vote.
create table apartman_private.decision_reads(
 decision_id integer not null references public.apartman_decisions(id) on delete cascade,
 unit_id integer not null references public.apartman_units(id) on delete cascade,
 decision_version timestamptz not null,
 read_at timestamptz not null default clock_timestamp(),
 primary key(decision_id,unit_id)
);
create index decision_reads_unit_idx on apartman_private.decision_reads(unit_id);
alter table apartman_private.decision_reads enable row level security;
revoke all on apartman_private.decision_reads from public,anon,authenticated;

create function apartman_private.decision_read_summary(target integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.apartman_decisions%rowtype;result jsonb;rows jsonb;
begin
 select * into d from public.apartman_decisions where id=target;
 if not found then raise exception 'Karar bulunamadı.';end if;
 select jsonb_build_object('decisionId',d.id,'version',d.updated_at::text,'archived',d.archived,'total',count(*),'read',count(r.unit_id)) into result
 from public.apartman_units u left join apartman_private.decision_reads r on r.unit_id=u.id and r.decision_id=d.id and r.decision_version=d.updated_at;
 if apartman_private.is_admin() then
  select coalesce(jsonb_agg(jsonb_build_object('unitId',u.id,'label',u.label,'read',r.unit_id is not null,'readAt',r.read_at) order by u.id),'[]'::jsonb) into rows
  from public.apartman_units u left join apartman_private.decision_reads r on r.unit_id=u.id and r.decision_id=d.id and r.decision_version=d.updated_at;
  result:=result||jsonb_build_object('units',rows);
 end if;
 return result;
end $$;
revoke all on function apartman_private.decision_read_summary(integer) from public,anon,authenticated;

create function apartman_private.decision_read(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare target integer;unit integer;operation text;d public.apartman_decisions%rowtype;old apartman_private.decision_reads%rowtype;
begin
 if octet_length(payload::text)>1500 then raise exception 'Geçersiz okudum bildirimi.';end if;
 target:=(payload->>'decisionId')::integer;operation:=coalesce(payload->>'operation','summary');
 if operation='summary' then return apartman_private.decision_read_summary(target);end if;
 if operation not in ('mark','remove') then raise exception 'Geçersiz işlem.';end if;
 if operation='remove' and not apartman_private.is_admin() then raise exception 'Yönetici yetkisi gerekli.' using errcode='42501';end if;
 -- Lock the decision so an edit cannot race a declaration for the old text.
 select * into d from public.apartman_decisions where id=target for update;
 if not found or payload->>'version' is null or (payload->>'version')::timestamptz is distinct from d.updated_at then raise exception 'Karar değişmiş. Listeyi yenileyip tekrar okuyun.';end if;
 unit:=(payload->>'unitId')::integer;
 if not exists(select 1 from public.apartman_units where id=unit) then raise exception 'Geçerli daire / dükkân seçin.';end if;
 if operation='remove' then
  select * into old from apartman_private.decision_reads where decision_id=target and unit_id=unit for update;
  if found then
   if old.decision_version<>d.updated_at or payload->>'readAt' is null or (payload->>'readAt')::timestamptz is distinct from old.read_at then raise exception 'Bildirim değişmiş. Listeyi yenileyin.';end if;
   delete from apartman_private.decision_reads where decision_id=target and unit_id=unit;
  end if;
 else
  if d.archived then raise exception 'Arşivdeki karar için bildirim alınmıyor.';end if;
  insert into apartman_private.decision_reads(decision_id,unit_id,decision_version) values(target,unit,d.updated_at)
  on conflict(decision_id,unit_id) do update set decision_version=excluded.decision_version,read_at=clock_timestamp()
  where apartman_private.decision_reads.decision_version<>excluded.decision_version;
 end if;
 return apartman_private.decision_read_summary(target)||jsonb_build_object('ok',true);
end $$;
revoke all on function apartman_private.decision_read(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.decision_read(jsonb) to anon,authenticated;
create function public.apartman_decision_reads(payload jsonb) returns jsonb language sql security invoker set search_path='' as $$select apartman_private.decision_read(payload)$$;
revoke all on function public.apartman_decision_reads(jsonb) from public;
grant execute on function public.apartman_decision_reads(jsonb) to anon,authenticated;
