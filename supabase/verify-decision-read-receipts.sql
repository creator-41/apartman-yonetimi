begin;
do $$
declare decision integer;unit integer;version text;result jsonb;first_seen timestamptz;admin_id uuid;before_totals jsonb;
begin
 before_totals:=public.apartman_state()->'totals';
 select id into unit from public.apartman_units order by id limit 1;
 select user_id into admin_id from public.apartman_admins limit 1;
 insert into public.apartman_decisions(title,body,date) values('TEST_READ_RECEIPT','Synthetic decision only',current_date) returning id,updated_at::text into decision,version;
 perform set_config('request.jwt.claim.sub','',true);
 result:=public.apartman_decision_reads(jsonb_build_object('decisionId',decision));
 assert not (result?'units'),'Public per-unit tracking leaked';assert (result->>'read')::int=0;
 result:=public.apartman_decision_reads(jsonb_build_object('operation','mark','decisionId',decision,'unitId',unit,'version',version));
 assert (result->>'read')::int=1 and not (result?'units');
 select read_at into first_seen from apartman_private.decision_reads where decision_id=decision and unit_id=unit;
 perform public.apartman_decision_reads(jsonb_build_object('operation','mark','decisionId',decision,'unitId',unit,'version',version));
 assert (select count(*)=1 and min(read_at)=first_seen from apartman_private.decision_reads where decision_id=decision),'Duplicate changed the receipt';
 begin
  perform public.apartman_decision_reads(jsonb_build_object('operation','remove','decisionId',decision,'unitId',unit,'version',version,'readAt',first_seen));raise exception 'Public removal allowed';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 result:=public.apartman_decision_reads(jsonb_build_object('decisionId',decision));
 assert result?'units' and jsonb_array_length(result->'units')=(result->>'total')::int,'Admin unit tracking missing';
 assert result::text not like '%owner%' and result::text not like '%resident%','Personal fields leaked';
 assert exists(select 1 from jsonb_array_elements(apartman_private.backup()->'tables'->'decisionReads') r where (r->>'decision_id')::int=decision),'Receipt missing from backup';
 begin
  perform public.apartman_decision_reads(jsonb_build_object('operation','remove','decisionId',decision,'unitId',unit,'version',version,'readAt',first_seen+interval '1 second'));raise exception 'Stale removal accepted';
 exception when raise_exception then if sqlerrm='Stale removal accepted' then raise;end if;end;
 perform public.apartman_decision_reads(jsonb_build_object('operation','remove','decisionId',decision,'unitId',unit,'version',version,'readAt',first_seen));
 assert not exists(select 1 from apartman_private.decision_reads where decision_id=decision),'Admin removal failed';
 perform set_config('request.jwt.claim.sub','',true);
 perform public.apartman_decision_reads(jsonb_build_object('operation','mark','decisionId',decision,'unitId',unit,'version',version));
 update public.apartman_decisions set body='Changed synthetic text',updated_at=clock_timestamp() where id=decision;
 result:=public.apartman_decision_reads(jsonb_build_object('decisionId',decision));assert (result->>'read')::int=0,'Old text counted';
 begin
  perform public.apartman_decision_reads(jsonb_build_object('operation','mark','decisionId',decision,'unitId',unit,'version',version));raise exception 'Stale mark accepted';
 exception when raise_exception then if sqlerrm='Stale mark accepted' then raise;end if;end;
 version:=result->>'version';perform public.apartman_decision_reads(jsonb_build_object('operation','mark','decisionId',decision,'unitId',unit,'version',version));
 result:=public.apartman_decision_reads(jsonb_build_object('decisionId',decision));assert (result->>'read')::int=1;
 update public.apartman_decisions set archived=true where id=decision;
 begin
  perform public.apartman_decision_reads(jsonb_build_object('operation','mark','decisionId',decision,'unitId',unit,'version',version));raise exception 'Archived mark accepted';
 exception when raise_exception then if sqlerrm='Archived mark accepted' then raise;end if;end;
 assert public.apartman_state()->'totals'=before_totals,'Financial totals changed';
end $$;
set local role anon;
do $$begin
 begin perform 1 from apartman_private.decision_reads;raise exception 'Direct read allowed';exception when insufficient_privilege then null;end;
 begin perform apartman_private.decision_read_summary(1);raise exception 'Private helper allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
