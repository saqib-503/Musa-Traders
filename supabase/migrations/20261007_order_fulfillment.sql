-- Run once in the Supabase SQL Editor after the previous Nestling migrations.
-- Adds a controlled fulfilment workflow without removing orders or customer data.
begin;

alter table orders drop constraint if exists order_status_valid;
alter table orders add constraint order_status_valid check (status in (
  'pending','received','confirmed','packed','handed_to_courier',
  'out_for_delivery','delivered','cancelled'
)) not valid;
alter table orders alter column status set default 'received';

-- Map the two legacy status names into the new workflow.
update orders set status=case
  when status='pending' then 'received'
  when status='shipped' then 'handed_to_courier'
  else status
end where status in ('pending','shipped');

create table if not exists order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders on delete cascade,
  status text not null check (status in ('received','confirmed','packed','handed_to_courier','out_for_delivery','delivered','cancelled')),
  note text check (note is null or length(note) <= 500),
  changed_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists order_status_history_order on order_status_history(order_id,created_at);
alter table order_status_history enable row level security;
create policy order_history_read on order_status_history for select using (
  is_admin() or exists(select 1 from orders o where o.id=order_id and o.user_id=auth.uid())
);
revoke all on order_status_history from anon,authenticated;
grant select on order_status_history to authenticated;

-- One initial timeline event for every order already in the store.
insert into order_status_history(order_id,status,note,changed_by,created_at)
select id,status,null,user_id,created_at from orders
where status <> 'pending'
  and not exists (select 1 from order_status_history h where h.order_id=orders.id);

create or replace function record_new_order_status() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into order_status_history(order_id,status,changed_by)
  values(new.id, case when new.status='pending' then 'received' else new.status end, new.user_id);
  return new;
end $$;
drop trigger if exists order_received_history on orders;
create trigger order_received_history after insert on orders
  for each row execute function record_new_order_status();

create or replace function update_order_status(p_order_id uuid,p_status text,p_note text default null) returns void
language plpgsql security definer set search_path=public as $$
declare current_status text; allowed boolean := false;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('confirmed','packed','handed_to_courier','out_for_delivery','delivered','cancelled') then
    raise exception 'Invalid fulfilment status';
  end if;
  select status into current_status from orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  allowed := (current_status in ('pending','received') and p_status in ('confirmed','cancelled'))
    or (current_status='confirmed' and p_status in ('packed','cancelled'))
    or (current_status='packed' and p_status in ('handed_to_courier','cancelled'))
    or (current_status='handed_to_courier' and p_status='out_for_delivery')
    or (current_status='out_for_delivery' and p_status='delivered');
  if not allowed then raise exception 'This status change is not allowed from %',current_status; end if;
  update orders set status=p_status where id=p_order_id;
  insert into order_status_history(order_id,status,note,changed_by)
    values(p_order_id,p_status,nullif(btrim(p_note),''),auth.uid());
end $$;
revoke all on function update_order_status(uuid,text,text) from public,anon;
grant execute on function update_order_status(uuid,text,text) to authenticated;

-- The RPC above is the only permitted way to move an order through fulfilment.
revoke update on orders from public,anon,authenticated;

create or replace function notify_order_status() returns trigger language plpgsql security definer set search_path=public as $$
declare label text;
begin
 if new.status is distinct from old.status and new.user_id is not null then
  label:=case new.status
    when 'received' then 'Order received'
    when 'confirmed' then 'Order confirmed'
    when 'packed' then 'Order packed'
    when 'handed_to_courier' then 'Parcel handed to courier'
    when 'out_for_delivery' then 'Out for delivery'
    when 'delivered' then 'Delivered'
    when 'cancelled' then 'Cancelled'
    else new.status end;
  insert into notifications(user_id,order_id,message)
    values(new.user_id,new.id,'Order #'||left(new.id::text,8)||': '||label||'.');
 end if;
 return new;
end $$;

create or replace function backend_version() returns text language sql stable set search_path=public as $$select '20261007'::text$$;
commit;
