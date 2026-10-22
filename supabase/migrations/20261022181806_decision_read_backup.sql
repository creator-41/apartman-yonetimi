-- Preserve the existing admin gate and backup fields; append receipt records.
do $$
declare definition text;needle text:='''residentRequests'',coalesce((select jsonb_agg(to_jsonb(r)) from public.apartman_requests r),''[]'')';
begin
 definition:=pg_get_functiondef('apartman_private.backup()'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Unexpected backup definition';end if;
 execute replace(definition,needle,needle||',''decisionReads'',coalesce((select jsonb_agg(to_jsonb(dr) order by decision_id,unit_id) from apartman_private.decision_reads dr),''[]'')');
end $$;
