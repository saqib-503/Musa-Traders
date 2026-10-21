-- Run once in Supabase SQL Editor after 20261007_order_fulfillment.sql.
-- Configurable COD and advance bank-transfer checkout, with server-side totals.
begin;

create table store_payment_settings (
  id boolean primary key default true check (id),
  cod_enabled boolean not null default true,
  bank_transfer_enabled boolean not null default true,
  cod_surcharge_percent numeric(5,2) not null default 0 check (cod_surcharge_percent between 0 and 100),
  bank_name text not null default '',
  account_title text not null default '',
  account_number text not null default '',
  iban text not null default '',
  payment_instructions text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users on delete set null
);
insert into store_payment_settings(id) values(true) on conflict do nothing;
alter table store_payment_settings enable row level security;
create policy payment_settings_read on store_payment_settings for select using(true);
create policy payment_settings_admin on store_payment_settings for all using(is_admin()) with check(is_admin());
grant select on store_payment_settings to anon,authenticated;
grant update on store_payment_settings to authenticated;

alter table orders add column payment_status text not null default 'unpaid';
alter table orders add column payment_reference text;
alter table orders add column cod_surcharge numeric(10,2) not null default 0;
alter table orders drop constraint if exists order_payment_method_valid;
alter table orders add constraint order_payment_method_valid check (payment_method in ('cod','bank_transfer')) not valid;
alter table orders drop constraint if exists order_payment_status_valid;
alter table orders add constraint order_payment_status_valid check (payment_status in ('unpaid','pending_verification','paid','failed','refunded')) not valid;
alter table orders add constraint order_cod_surcharge_valid check (cod_surcharge >= 0) not valid;

create or replace function touch_payment_settings() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at:=clock_timestamp();new.updated_by:=auth.uid();return new;end $$;
drop trigger if exists payment_settings_updated on store_payment_settings;
create trigger payment_settings_updated before update on store_payment_settings
  for each row execute function touch_payment_settings();

drop function place_order(jsonb,text,text,text,text,text,uuid);
create function place_order(items jsonb,p_name text,p_phone text,p_address text,p_city text,
  p_coupon text default null,p_request_id uuid default null,p_payment_method text default 'cod',
  p_payment_reference text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare oid uuid; sub numeric:=0; pct int:=0; disc numeric; ship numeric; cod_fee numeric:=0;
  r record; v record; payload jsonb; previous jsonb; promo coupons; uses int; settings store_payment_settings;
begin
  if auth.uid() is null then raise exception 'Sign in to place an order'; end if;
  if p_request_id is null then raise exception 'Missing checkout request ID'; end if;
  if items is null or jsonb_typeof(items) is distinct from 'array' then raise exception 'Invalid cart'; end if;
  if jsonb_array_length(items) not between 1 and 100 then raise exception 'Cart must contain 1 to 100 items'; end if;
  p_name:=btrim(p_name); p_phone:=btrim(p_phone); p_address:=btrim(p_address); p_city:=btrim(p_city);
  p_coupon:=nullif(upper(btrim(p_coupon)), ''); p_payment_method:=lower(btrim(p_payment_method));
  p_payment_reference:=nullif(btrim(p_payment_reference),'');
  if coalesce(length(p_name),0) not between 1 and 120 or coalesce(length(p_phone),0) not between 5 and 30
    or coalesce(length(p_address),0) not between 1 and 500 or coalesce(length(p_city),0) not between 1 and 120 then
    raise exception 'Enter a valid name, phone, address and city'; end if;
  if p_payment_method not in ('cod','bank_transfer') then raise exception 'Choose a valid payment method'; end if;
  if p_payment_reference is not null and length(p_payment_reference)>120 then raise exception 'Payment reference is too long'; end if;
  for r in select e from jsonb_array_elements(items) e loop
    if jsonb_typeof(r.e) is distinct from 'object'
      or coalesce(r.e->>'variant_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(r.e->>'qty','') !~ '^[0-9]{1,2}$' then raise exception 'Invalid cart item'; end if;
    if (r.e->>'qty')::int not between 1 and 20 then raise exception 'Quantity must be between 1 and 20'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('variant_id',vid,'qty',q) order by vid) into items from (
    select (e->>'variant_id')::uuid vid,sum((e->>'qty')::int) q from jsonb_array_elements(items) e group by (e->>'variant_id')::uuid
  ) lines;
  if exists(select 1 from jsonb_array_elements(items) e where (e->>'qty')::int>20) then raise exception 'Quantity must be between 1 and 20'; end if;
  select * into settings from store_payment_settings where id=true for update;
  if not found then raise exception 'Payment settings are unavailable'; end if;
  if p_payment_method='cod' and not settings.cod_enabled then raise exception 'Cash on delivery is unavailable'; end if;
  if p_payment_method='bank_transfer' and not settings.bank_transfer_enabled then raise exception 'Bank transfer is unavailable'; end if;
  if p_payment_method='bank_transfer' and coalesce(length(p_payment_reference),0)<3 then raise exception 'Enter your bank transfer reference'; end if;
  payload:=jsonb_build_object('items',items,'name',p_name,'phone',p_phone,'address',p_address,'city',p_city,'coupon',p_coupon,'payment_method',p_payment_method,'payment_reference',p_payment_reference);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
  select id,request_payload into oid,previous from orders where user_id=auth.uid() and request_id=p_request_id;
  if found then if previous is distinct from payload then raise exception 'This checkout request was already used for different details'; end if; return oid; end if;
  if p_coupon is not null then
    select * into promo from coupons where code=p_coupon and active for update;
    if not found then raise exception 'Coupon is invalid or inactive'; end if;
    if promo.starts_at>now() then raise exception 'Coupon has not started yet'; end if;
    if promo.ends_at<=now() then raise exception 'Coupon has expired'; end if;
    select count(*) into uses from orders where coupon_code=p_coupon;
    if promo.usage_limit is not null and uses>=promo.usage_limit then raise exception 'Coupon usage limit reached'; end if;
    pct:=coalesce(promo.percent,0);
  end if;
  insert into orders(user_id,name,phone,address,city,coupon_code,request_id,request_payload,payment_method,payment_status,payment_reference)
    values(auth.uid(),p_name,p_phone,p_address,p_city,p_coupon,p_request_id,payload,p_payment_method,case when p_payment_method='bank_transfer' then 'pending_verification' else 'unpaid' end,p_payment_reference) returning id into oid;
  for r in select (e->>'variant_id')::uuid vid,(e->>'qty')::int q from jsonb_array_elements(items) e order by (e->>'variant_id')::uuid loop
    select pv.*,p.name pname,p.status pst,coalesce(pv.price_override,p.sale_price,p.regular_price) price into v from product_variants pv join products p on p.id=pv.product_id where pv.id=r.vid for update of pv;
    if not found or v.pst is distinct from 'active' then raise exception 'Product unavailable'; end if;
    if v.price is null or v.price<0 then raise exception 'Invalid product price'; end if;
    if v.stock<r.q then raise exception 'Not enough stock for %',v.pname; end if;
    update product_variants set stock=stock-r.q where id=r.vid;
    insert into order_items(order_id,product_id,variant_id,name,unit_price,qty) values(oid,v.product_id,v.id,v.pname||coalesce(' / '||v.color,'')||coalesce(' / '||v.size,''),v.price,r.q);
    sub:=sub+v.price*r.q;
  end loop;
  disc:=case when p_coupon is not null and promo.discount_type='fixed' then least(sub,promo.amount) else round(sub*pct/100,2) end;
  ship:=case when sub-disc>=5000 then 0 else 250 end;
  cod_fee:=case when p_payment_method='cod' then round((sub-disc+ship)*settings.cod_surcharge_percent/100,2) else 0 end;
  update orders set subtotal=sub,discount=disc,shipping=ship,cod_surcharge=cod_fee,total=sub-disc+ship+cod_fee where id=oid;
  return oid;
end $$;
revoke all on function place_order(jsonb,text,text,text,text,text,uuid,text,text) from public,anon;
grant execute on function place_order(jsonb,text,text,text,text,text,uuid,text,text) to authenticated;

create function update_order_payment(p_order_id uuid,p_payment_status text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_payment_status not in ('unpaid','pending_verification','paid','failed','refunded') then raise exception 'Invalid payment status'; end if;
  update orders set payment_status=p_payment_status where id=p_order_id;
  if not found then raise exception 'Order not found'; end if;
end $$;
revoke all on function update_order_payment(uuid,text) from public,anon;
grant execute on function update_order_payment(uuid,text) to authenticated;

create or replace function backend_version() returns text language sql stable set search_path=public as $$select '20261008'::text$$;
commit;
