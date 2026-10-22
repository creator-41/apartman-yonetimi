-- Include only the request UUID for administrator links. The resident access token stays private.
do $$
declare definition text;old_text text:=$old$'requestId',r.id$old$;
begin
 select pg_get_functiondef('apartman_private.push_worker(jsonb)'::regprocedure) into definition;
 if position(old_text in definition)=0 then raise exception 'Unexpected push worker definition; no changes applied.';end if;
 definition:=replace(definition,old_text,$new$'requestId',coalesce(r.id,case when c.kind='request' then split_part(c.event_key,':',2)::uuid end)$new$);
 execute definition;
end $$;
