-- Financial changes made after this upgrade can be reversed with dependency checks.
-- STEP: journal
create table public.apartman_changes(
 id bigint generated always as identity primary key,
 entity text not null check(entity in('payment','expense')),
 operation text not null check(operation in('INSERT','UPDATE','DELETE')),
 record_id integer not null,
 before_row jsonb,after_row jsonb,
 actor uuid not null,actor_label text not null,
 created_at timestamptz not null default clock_timestamp(),
 transaction_id bigint not null default txid_current(),
 undone_at timestamptz,undone_by uuid,undone_label text,
 undo_of bigint references public.apartman_changes(id)
);
create index apartman_changes_record_idx on public.apartman_changes(entity,record_id,id desc);
alter table public.apartman_changes enable row level security;
revoke all on public.apartman_changes from public,anon,authenticated;
revoke all on sequence public.apartman_changes_id_seq from public,anon,authenticated;
create function apartman_private.capture_change()
returns trigger language plpgsql security definer set search_path=''
as $capture$
declare old_row jsonb;new_row jsonb;
begin
 if apartman_private.is_admin() then
  if TG_OP<>'INSERT' then old_row:=to_jsonb(OLD);end if;
  if TG_OP<>'DELETE' then new_row:=to_jsonb(NEW);end if;
  if old_row is distinct from new_row then
   insert into public.apartman_changes(entity,operation,record_id,before_row,after_row,actor,actor_label)
   values(case TG_TABLE_NAME when 'apartman_payments' then 'payment' else 'expense' end,TG_OP,coalesce((new_row->>'id')::int,(old_row->>'id')::int),old_row,new_row,auth.uid(),coalesce(nullif(auth.jwt()->>'email',''),'Yönetici '||left(auth.uid()::text,8)));
  end if;
 end if;
 return null;
end;$capture$;
revoke all on function apartman_private.capture_change() from public,anon,authenticated;
create trigger apartman_capture_payment after insert or delete on public.apartman_payments for each row execute function apartman_private.capture_change();
create trigger apartman_capture_expense after insert or update or delete on public.apartman_expenses for each row execute function apartman_private.capture_change();

-- STEP: payment_restore
create function apartman_private.restore_payment(data jsonb)
returns void language plpgsql security invoker set search_path=''
as $f$
declare p public.apartman_payments%rowtype;remaining bigint;
begin
 p:=jsonb_populate_record(null::public.apartman_payments,data);
 select c.amount-coalesce((select sum(amount) from public.apartman_payments where charge_id=c.id),0) into remaining from public.apartman_charges c where c.id=p.charge_id for update;
 if not found or p.amount>remaining then raise exception 'Aidat kaldırılmış veya kalan borç yetersiz.';end if;
 insert into public.apartman_payments(id,charge_id,amount,date,note,created_at) overriding system value values(p.id,p.charge_id,p.amount,p.date,p.note,p.created_at);
end;$f$;
revoke all on function apartman_private.restore_payment(jsonb) from public,anon,authenticated;

create function apartman_private.undo_payment(change public.apartman_changes)
returns void language plpgsql volatile security invoker set search_path=''
as $undo$
declare current_row jsonb;p public.apartman_payments%rowtype;remaining bigint;
begin
 select to_jsonb(t) into current_row from public.apartman_payments t where id=change.record_id for update;
 if change.operation='INSERT' then
  if current_row is distinct from change.after_row then raise exception 'Ödeme değişmiş veya iptal edilmiş. Listeyi yenileyin.';end if;
  delete from public.apartman_payments where id=change.record_id;
 elsif change.operation='DELETE' then
  if current_row is not null then raise exception 'Bu ödeme numarası zaten kullanılıyor.';end if;
  perform apartman_private.restore_payment(change.before_row);
 else raise exception 'Bu ödeme işlemi geri alınamıyor.';end if;
end;$undo$;
revoke all on function apartman_private.undo_payment(public.apartman_changes) from public,anon,authenticated;

-- STEP: expense_restore
create function apartman_private.restore_expense(data jsonb)
returns void language plpgsql security invoker set search_path=''
as $f$ declare e public.apartman_expenses%rowtype;begin
 e:=jsonb_populate_record(null::public.apartman_expenses,data);
 insert into public.apartman_expenses(id,category,description,amount,date,created_at) overriding system value values(e.id,e.category,e.description,e.amount,e.date,e.created_at);
end;$f$;
revoke all on function apartman_private.restore_expense(jsonb) from public,anon,authenticated;

create function apartman_private.undo_expense(change public.apartman_changes)
returns void language plpgsql volatile security invoker set search_path=''
as $undo$
declare current_row jsonb;e public.apartman_expenses%rowtype;
begin
 select to_jsonb(t) into current_row from public.apartman_expenses t where id=change.record_id for update;
 if change.operation='INSERT' then
  if current_row is distinct from change.after_row then raise exception 'Gider değişmiş veya kaldırılmış. Listeyi yenileyin.';end if;
  if exists(select 1 from public.apartman_expense_files where expense_id=change.record_id) then raise exception 'Bu gidere belge eklenmiş. Önce Belgeler bölümünden kaldırın.';end if;
  delete from public.apartman_expenses where id=change.record_id;
 elsif change.operation='DELETE' then
  if current_row is not null then raise exception 'Bu gider numarası zaten kullanılıyor.';end if;
  perform apartman_private.restore_expense(change.before_row);
 elsif change.operation='UPDATE' then
  if current_row is distinct from change.after_row then raise exception 'Gider sonradan değişmiş. Önce son değişikliği geri alın.';end if;
  e:=jsonb_populate_record(null::public.apartman_expenses,change.before_row);
  update public.apartman_expenses set category=e.category,description=e.description,amount=e.amount,date=e.date,created_at=e.created_at where id=change.record_id;
 else raise exception 'Geçersiz gider işlemi.';end if;
end;$undo$;
revoke all on function apartman_private.undo_expense(public.apartman_changes) from public,anon,authenticated;

-- STEP: undo_rpc
create function apartman_private.undo_change(change_id bigint)
returns jsonb language plpgsql volatile security definer set search_path=''
as $undo$
declare entry public.apartman_changes%rowtype;last_id bigint;n integer;label text;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 perform id from public.apartman_settings where id=1 for update;
 select * into entry from public.apartman_changes where id=change_id for update;
 if not found then raise exception 'İşlem bulunamadı.';end if;
 if entry.undone_at is not null then raise exception 'Bu işlem zaten geri alınmış.';end if;
 if entry.undo_of is not null then raise exception 'Geri alma kaydı tekrar geri alınamaz.';end if;
 if exists(select 1 from public.apartman_changes where entity=entry.entity and record_id=entry.record_id and id>entry.id and undone_at is null and undo_of is null) then raise exception 'Bu kayıt sonradan değişmiş. Önce en son işlemini geri alın.';end if;
 select coalesce(max(id),0) into last_id from public.apartman_changes;
 if entry.entity='payment' then perform apartman_private.undo_payment(entry);else perform apartman_private.undo_expense(entry);end if;
 update public.apartman_changes set undo_of=entry.id where id>last_id and transaction_id=txid_current();get diagnostics n=row_count;
 if n<>1 then raise exception 'Geri alma kaydı doğrulanamadı.';end if;
 label:=coalesce(nullif(auth.jwt()->>'email',''),'Yönetici '||left(auth.uid()::text,8));
 update public.apartman_changes set undone_at=clock_timestamp(),undone_by=auth.uid(),undone_label=label where id=entry.id;
 insert into public.apartman_audit(action,details) values('Ödeme / gider işlemi geri alındı',jsonb_build_object('changeId',entry.id,'entity',entry.entity,'recordId',entry.record_id));
 return jsonb_build_object('ok',true);
end;$undo$;
revoke all on function apartman_private.undo_change(bigint) from public,anon,authenticated;
grant execute on function apartman_private.undo_change(bigint) to authenticated;
create function public.apartman_undo(change_id bigint)
returns jsonb language sql volatile security invoker set search_path=''
as $$select apartman_private.undo_change(change_id);$$;
revoke all on function public.apartman_undo(bigint) from public,anon,authenticated;
grant execute on function public.apartman_undo(bigint) to authenticated;

-- STEP: history_rpc
create function apartman_private.change_history()
returns jsonb language plpgsql stable security definer set search_path=''
as $history$
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(c) order by c.id desc) from (select id,entity,operation,record_id,before_row,after_row,actor_label,created_at,undone_at,undone_label,undo_of from public.apartman_changes order by id desc limit 100)c),'[]');
end;$history$;
revoke all on function apartman_private.change_history() from public,anon,authenticated;
grant execute on function apartman_private.change_history() to authenticated;
create function public.apartman_change_history()
returns jsonb language sql stable security invoker set search_path=''
as $$select apartman_private.change_history();$$;
revoke all on function public.apartman_change_history() from public,anon,authenticated;
grant execute on function public.apartman_change_history() to authenticated;

-- STEP: backup
create or replace function apartman_private.backup()
returns jsonb language plpgsql volatile security definer set search_path=''
as $backup$
declare result jsonb;
begin
 if not apartman_private.is_admin() then raise exception 'Apartman yöneticisi yetkisi gerekli.' using errcode='42501';end if;
 result:=apartman_private.action('backup','{}');
 return jsonb_set(result,'{tables}',(result->'tables')||jsonb_build_object('decisions',coalesce((select jsonb_agg(to_jsonb(d)) from public.apartman_decisions d),'[]'),'tasks',coalesce((select jsonb_agg(to_jsonb(t)) from public.apartman_tasks t),'[]'),'changes',coalesce((select jsonb_agg(to_jsonb(c) order by id) from public.apartman_changes c),'[]')));
end;$backup$;
notify pgrst,'reload schema';
