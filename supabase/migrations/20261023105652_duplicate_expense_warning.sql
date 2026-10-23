create function apartman_private.expense_save(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $save$
declare n bigint;day date;description_key text;matches jsonb;target integer;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>30000 or coalesce(payload->>'operation','') not in ('create','update') then raise exception 'Geçersiz gider işlemi.';end if;
 n:=apartman_private.money(payload->'amount');
 if coalesce(payload->>'date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' or length(btrim(coalesce(payload->>'description',''))) not between 1 and 300 then raise exception 'Tarih ve açıklamayı kontrol edin.';end if;
 day:=(payload->>'date')::date;
 if coalesce(payload->>'category','') not in ('Temizlik','Elektrik','Su','Asansör','Bakım / Onarım','Yönetim gideri','Diğer') then raise exception 'Geçerli kategori seçin.';end if;
 if payload->>'operation'='update' then target:=(payload->>'expenseId')::integer;if target is null then raise exception 'Gider bulunamadı.';end if;end if;
 description_key:=lower(translate(regexp_replace(btrim(payload->>'description'),'\s+',' ','g'),'Iİ','ıi'));
 -- Use the same apartment lock as the existing financial writes; a newly added match
 -- invalidates a previous confirmation before the save can proceed.
 perform id from public.apartman_settings where id=1 for update;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'date',e.date,'category',e.category,'description',e.description,'amount',e.amount) order by e.id),'[]') into matches
 from public.apartman_expenses e where (target is null or e.id<>target) and e.date=day and e.amount=n
 and lower(translate(regexp_replace(btrim(e.description),'\s+',' ','g'),'Iİ','ıi'))=description_key;
 if jsonb_array_length(matches)>0 and (payload->'separateExpense' is distinct from 'true'::jsonb or payload->'confirmedMatches' is distinct from matches) then
  return jsonb_build_object('duplicate',true,'matches',matches);
 end if;
 if payload->>'operation'='update' then return apartman_private.expense_update(payload);end if;
 return apartman_private.action('expense',payload);
end;$save$;
revoke all on function apartman_private.expense_save(jsonb) from public,anon,authenticated;
grant execute on function apartman_private.expense_save(jsonb) to authenticated;
create function public.apartman_expense_save(payload jsonb) returns jsonb language sql volatile security invoker set search_path='' as $$select apartman_private.expense_save(payload);$$;
revoke all on function public.apartman_expense_save(jsonb) from public,anon,authenticated;
grant execute on function public.apartman_expense_save(jsonb) to authenticated;
