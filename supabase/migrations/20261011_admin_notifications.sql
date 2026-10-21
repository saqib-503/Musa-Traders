-- Run once after the existing Musa Traders migrations.
-- Creates a private notification inbox for every administrator.
begin;

create table if not exists admin_notifications (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users on delete cascade,
  order_id uuid references orders on delete cascade,
  review_id uuid references product_reviews on delete cascade,
  kind text not null check (kind in ('new_order','bank_transfer','pending_review')),
  message text not null check (length(message) between 1 and 500),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(admin_id,order_id,kind),
  unique(admin_id,review_id,kind)
);
create index if not exists admin_notifications_inbox on admin_notifications(admin_id,read_at,created_at desc);
alter table admin_notifications enable row level security;
create policy admin_notifications_read on admin_notifications for select using (admin_id=auth.uid() and is_admin());
create policy admin_notifications_mark_read on admin_notifications for update using (admin_id=auth.uid() and is_admin()) with check (admin_id=auth.uid() and is_admin());
revoke all on admin_notifications from public,anon,authenticated;
grant select on admin_notifications to authenticated;
grant update(read_at) on admin_notifications to authenticated;

create or replace function create_admin_notification(p_kind text,p_message text,p_order_id uuid default null,p_review_id uuid default null) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into admin_notifications(admin_id,order_id,review_id,kind,message)
  select id,p_order_id,p_review_id,p_kind,p_message
  from profiles where role='admin'
  on conflict do nothing;
end $$;
revoke all on function create_admin_notification(text,text,uuid,uuid) from public,anon,authenticated;

create or replace function notify_admin_new_order() returns trigger
language plpgsql security definer set search_path=public as $$
declare label text; notice_kind text;
begin
  notice_kind:=case when new.payment_method='bank_transfer' then 'bank_transfer' else 'new_order' end;
  label:=case when new.payment_method='bank_transfer'
    then 'New bank-transfer order #'||left(new.id::text,8)||' needs payment verification.'
    else 'New cash-on-delivery order #'||left(new.id::text,8)||' has been received.' end;
  perform create_admin_notification(notice_kind,label,new.id,null);
  return new;
end $$;
drop trigger if exists order_admin_notification on orders;
create trigger order_admin_notification after insert on orders for each row execute function notify_admin_new_order();

create or replace function notify_admin_pending_review() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform create_admin_notification('pending_review','A new customer review is waiting for approval.',null,new.id);
  return new;
end $$;
drop trigger if exists review_admin_notification on product_reviews;
create trigger review_admin_notification after insert on product_reviews for each row execute function notify_admin_pending_review();

-- Make existing open orders visible after first installation without duplicating them on later runs.
insert into admin_notifications(admin_id,order_id,kind,message)
select p.id,o.id,case when o.payment_method='bank_transfer' then 'bank_transfer' else 'new_order' end,
  case when o.payment_method='bank_transfer'
    then 'Bank-transfer order #'||left(o.id::text,8)||' needs payment verification.'
    else 'Open order #'||left(o.id::text,8)||' needs attention.' end
from profiles p cross join orders o
where p.role='admin' and o.status in ('pending','received','confirmed','packed','handed_to_courier','out_for_delivery')
on conflict do nothing;

create or replace function backend_version() returns text language sql stable set search_path=public as $$select '20261011'::text$$;
commit;
