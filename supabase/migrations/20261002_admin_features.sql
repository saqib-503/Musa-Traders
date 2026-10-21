-- Run once on an existing Nestling database after 20261001_store_backend.sql.
-- Preserves existing accounts, products and orders. No demo data is inserted.
begin;

alter table products add column tags text[] not null default '{}';
create table related_products (
  product_id uuid references products on delete cascade,
  related_product_id uuid references products on delete cascade,
  primary key(product_id,related_product_id), check(product_id<>related_product_id)
);
alter table related_products enable row level security;
create policy related_read on related_products for select using(is_admin() or (
  exists(select 1 from products where id=product_id and status='active') and
  exists(select 1 from products where id=related_product_id and status='active')));
create policy related_admin on related_products for all using(is_admin()) with check(is_admin());
grant select on related_products to anon,authenticated;
grant insert,update,delete on related_products to authenticated;

-- Extend the existing atomic editor without weakening stock or stale-edit checks.
alter function save_product(uuid,jsonb,jsonb,bool,timestamptz) rename to save_product_base;
revoke all on function save_product_base(uuid,jsonb,jsonb,bool,timestamptz) from public,anon,authenticated;
create function save_product(p_id uuid,p_product jsonb,p_variants jsonb,
  p_create_only bool default false,p_expected_updated_at timestamptz default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare entry jsonb; pos int:=0; result uuid;
begin
  if not is_admin() then raise exception 'Admins only';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
  if p_create_only and exists(select 1 from products where id=p_id) then return p_id;end if;
  result:=save_product_base(p_id,p_product,p_variants,p_create_only,p_expected_updated_at);
  update products set sku=nullif(btrim(p_product->>'sku'),''),
    tags=array(select jsonb_array_elements_text(coalesce(p_product->'tags','[]'::jsonb))),
    featured=coalesce((p_product->>'featured')::bool,false),
    new_arrival=coalesce((p_product->>'new_arrival')::bool,false),
    best_seller=coalesce((p_product->>'best_seller')::bool,false) where id=p_id;
  for entry in select value from jsonb_array_elements(p_variants) loop
    update product_variants set sku=nullif(btrim(entry->>'sku'),'') where id=(entry->>'id')::uuid and product_id=p_id;
  end loop;
  if p_product ? 'images' then
    if jsonb_typeof(p_product->'images') is distinct from 'array' then raise exception 'Invalid images';end if;
    if jsonb_array_length(p_product->'images')>12 then raise exception 'Use at most 12 images';end if;
    delete from product_images where product_id=p_id;
    for entry in select value from jsonb_array_elements(p_product->'images') loop
      if coalesce(entry->>'url','') !~ '^https?://' then raise exception 'Invalid image URL';end if;
      insert into product_images(product_id,url,alt,sort_order) values(p_id,entry->>'url',coalesce(entry->>'alt',p_product->>'name'),pos);
      pos:=pos+1;
    end loop;
  end if;
  if p_product ? 'related_product_ids' then
    delete from related_products where product_id=p_id;
    for entry in select value from jsonb_array_elements(p_product->'related_product_ids') loop
      insert into related_products values(p_id,(entry#>>'{}')::uuid) on conflict do nothing;
    end loop;
  end if;
  return result;
end $$;
revoke all on function save_product(uuid,jsonb,jsonb,bool,timestamptz) from public,anon;
grant execute on function save_product(uuid,jsonb,jsonb,bool,timestamptz) to authenticated;

-- Preserve stock restoration for historical orders when deleting a catalog item.
create function protect_ordered_product() returns trigger language plpgsql set search_path=public as $$
begin
  if exists(select 1 from order_items where product_id=old.id) then
    raise exception 'This product has order history. Set it to Draft instead';
  end if;
  return old;
end $$;
create trigger product_history before delete on products for each row execute function protect_ordered_product();

-- Email and join date stay in auth.users; expose them only through an admin RPC.
create function admin_users(p_search text default '',p_page int default 0) returns jsonb
language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
 if not is_admin() then raise exception 'Admins only';end if;
 select jsonb_build_object('total',count(*),'rows',coalesce((select jsonb_agg(to_jsonb(r)) from (
   select p.id,p.full_name,p.phone,p.role,u.email,u.created_at from profiles p join auth.users u on u.id=p.id
   where concat_ws(' ',p.full_name,p.phone,u.email) ilike '%'||coalesce(p_search,'')||'%'
   order by u.created_at desc,p.id limit 25 offset greatest(coalesce(p_page,0),0)*25
 ) r),'[]'::jsonb)) into result from profiles p join auth.users u on u.id=p.id
 where concat_ws(' ',p.full_name,p.phone,u.email) ilike '%'||coalesce(p_search,'')||'%';
 return result;
end $$;
create function admin_set_role(p_user_id uuid,p_role text) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(61002);
 if not is_admin() then raise exception 'Admins only';end if;
 if p_role is null or p_role not in ('admin','customer') then raise exception 'Invalid role';end if;
 if p_user_id=auth.uid() then raise exception 'You cannot change your own role';end if;
 update profiles set role=p_role where id=p_user_id;
 if not found then raise exception 'Account not found';end if;
end $$;
revoke all on function admin_users(text,int),admin_set_role(uuid,text) from public,anon;
grant execute on function admin_users(text,int),admin_set_role(uuid,text) to authenticated;

create table product_reviews (
 id uuid primary key default gen_random_uuid(),product_id uuid not null references products on delete cascade,
 user_id uuid not null references auth.users on delete cascade,rating int not null check(rating between 1 and 5),
 title text not null check(length(btrim(title)) between 1 and 120),body text not null check(length(body)<=2000),
 approved bool not null default false,created_at timestamptz not null default now(),unique(product_id,user_id)
);
alter table product_reviews enable row level security;
create policy reviews_read on product_reviews for select using(is_admin() or user_id=auth.uid() or
 (approved and exists(select 1 from products where id=product_id and status='active')));
create policy reviews_submit on product_reviews for insert with check(user_id=auth.uid() and not approved and
 exists(select 1 from orders o join order_items i on i.order_id=o.id where o.user_id=auth.uid() and o.status='delivered' and i.product_id=product_reviews.product_id));
create policy reviews_manage on product_reviews for all using(is_admin()) with check(is_admin());
grant select on product_reviews to anon,authenticated;
grant insert,delete on product_reviews to authenticated;
revoke update on product_reviews from public,anon,authenticated;
grant update(approved) on product_reviews to authenticated;
create index reviews_product on product_reviews(product_id,created_at desc);

-- In-app order notifications are written in the same transaction as status changes.
create table notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,
 order_id uuid references orders on delete cascade,message text not null,
 read_at timestamptz,created_at timestamptz not null default now()
);
alter table notifications enable row level security;
create policy notices_read on notifications for select using(user_id=auth.uid());
create policy notices_update on notifications for update using(user_id=auth.uid()) with check(user_id=auth.uid());
revoke all on notifications from anon,authenticated;
grant select on notifications to authenticated;
grant update(read_at) on notifications to authenticated;
create index notices_user on notifications(user_id,created_at desc);
create function notify_order_status() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status is distinct from old.status and new.user_id is not null then
  insert into notifications(user_id,order_id,message) values(new.user_id,new.id,'Order #'||left(new.id::text,8)||' is now '||new.status||'.');
 end if;return new;
end $$;
create trigger order_notice after update of status on orders for each row execute function notify_order_status();

alter table coupons alter column percent drop not null;
alter table coupons add column discount_type text not null default 'percentage' check(discount_type in ('percentage','fixed'));
alter table coupons add column amount numeric(10,2);
alter table coupons add column description text;
alter table coupons add column starts_at timestamptz;
alter table coupons add column ends_at timestamptz;
alter table coupons add column usage_limit int check(usage_limit>0);
alter table coupons add constraint coupon_value check(
 (discount_type='percentage' and percent is not null and amount is null) or
 (discount_type='fixed' and amount>0 and amount is not null and percent is null));
alter table coupons add constraint coupon_dates check(ends_at is null or starts_at is null or ends_at>starts_at);

create function admin_analytics(p_since timestamptz default null) returns jsonb
language plpgsql security definer stable set search_path=public as $$
begin
 if not is_admin() then raise exception 'Admins only';end if;
 return jsonb_build_object(
  'users',(select count(*) from profiles),'products',(select count(*) from products),
  'active_products',(select count(*) from products where status='active'),
  'featured',(select count(*) from products where featured),'new_arrivals',(select count(*) from products where new_arrival),
  'orders',(select count(*) from orders where p_since is null or created_at>=p_since),
  'delivered_revenue',(select coalesce(sum(total),0) from orders where status='delivered' and (p_since is null or created_at>=p_since)),
  'open_value',(select coalesce(sum(total),0) from orders where status in ('pending','confirmed','shipped') and (p_since is null or created_at>=p_since)),
  'average_order',(select coalesce(avg(total),0) from orders where status='delivered' and (p_since is null or created_at>=p_since)),
  'statuses',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select status,count(*) total from orders where p_since is null or created_at>=p_since group by status order by status) r),
  'daily',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select (created_at at time zone 'Asia/Karachi')::date as "day",count(*) orders,sum(total) revenue from orders where status='delivered' and (p_since is null or created_at>=p_since) group by 1 order by 1 desc limit 31) r),
  'top_products',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select i.product_id,min(i.name) name,sum(i.qty) quantity,sum(i.qty*i.unit_price) sales from order_items i join orders o on o.id=i.order_id where o.status='delivered' and (p_since is null or o.created_at>=p_since) group by i.product_id order by sum(i.qty) desc limit 10) r),
  'low_stock',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select p.name,p.slug,v.color,v.size,v.stock from product_variants v join products p on p.id=v.product_id where p.status='active' and v.stock<=5 order by v.stock,p.name limit 25) r)
 );
end $$;
revoke all on function admin_analytics(timestamptz) from public,anon;
grant execute on function admin_analytics(timestamptz) to authenticated;

create or replace function place_order(items jsonb,p_name text,p_phone text,p_address text,p_city text,
  p_coupon text default null,p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare oid uuid; sub numeric:=0; pct int:=0; disc numeric; ship numeric;
  r record; v record; payload jsonb; previous jsonb; promo coupons; uses int;
begin
  if auth.uid() is null then raise exception 'Sign in to place an order'; end if;
  if p_request_id is null then raise exception 'Missing checkout request ID'; end if;
  if items is null or jsonb_typeof(items) is distinct from 'array' then
    raise exception 'Invalid cart';
  end if;
  if jsonb_array_length(items) not between 1 and 100 then raise exception 'Cart must contain 1 to 100 items'; end if;
  p_name:=btrim(p_name); p_phone:=btrim(p_phone); p_address:=btrim(p_address); p_city:=btrim(p_city);
  p_coupon:=nullif(upper(btrim(p_coupon)),'');
  if coalesce(length(p_name),0) not between 1 and 120
    or coalesce(length(p_phone),0) not between 5 and 30
    or coalesce(length(p_address),0) not between 1 and 500
    or coalesce(length(p_city),0) not between 1 and 120 then
    raise exception 'Enter a valid name, phone, address and city';
  end if;
  for r in select e from jsonb_array_elements(items) e loop
    if jsonb_typeof(r.e) is distinct from 'object'
      or coalesce(r.e->>'variant_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(r.e->>'qty','') !~ '^[0-9]{1,2}$' then
      raise exception 'Invalid cart item';
    end if;
    if (r.e->>'qty')::int not between 1 and 20 then raise exception 'Quantity must be between 1 and 20'; end if;
  end loop;
  -- Normalize order and merge duplicate variants before enforcing the per-variant limit.
  select jsonb_agg(jsonb_build_object('variant_id',vid,'qty',q) order by vid) into items
    from (select (e->>'variant_id')::uuid vid,sum((e->>'qty')::int) q
      from jsonb_array_elements(items) e group by (e->>'variant_id')::uuid) lines;
  if exists(select 1 from jsonb_array_elements(items) e where (e->>'qty')::int>20) then
    raise exception 'Quantity must be between 1 and 20';
  end if;
  payload:=jsonb_build_object('items',items,'name',p_name,'phone',p_phone,'address',p_address,'city',p_city,'coupon',p_coupon);
  -- Serialize retries for one customer/request; stock locks below protect different orders.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
  select id,request_payload into oid,previous from orders where user_id=auth.uid() and request_id=p_request_id;
  if found then
    if previous is distinct from payload then raise exception 'This checkout request was already used for different details'; end if;
    return oid;
  end if;
  if p_coupon is not null then
    select * into promo from coupons where code=p_coupon and active for update;
    if not found then raise exception 'Coupon is invalid or inactive'; end if;
    if promo.starts_at>now() then raise exception 'Coupon has not started yet';end if;
    if promo.ends_at<=now() then raise exception 'Coupon has expired';end if;
    select count(*) into uses from orders where coupon_code=p_coupon;
    if promo.usage_limit is not null and uses>=promo.usage_limit then raise exception 'Coupon usage limit reached';end if;
    pct:=coalesce(promo.percent,0);
  end if;
  insert into orders(user_id,name,phone,address,city,coupon_code,request_id,request_payload)
    values(auth.uid(),p_name,p_phone,p_address,p_city,p_coupon,p_request_id,payload) returning id into oid;
  for r in select (e->>'variant_id')::uuid vid,(e->>'qty')::int q
    from jsonb_array_elements(items) e order by (e->>'variant_id')::uuid loop
    select pv.*,p.name pname,p.status pst,coalesce(pv.price_override,p.sale_price,p.regular_price) price
      into v from product_variants pv join products p on p.id=pv.product_id
      where pv.id=r.vid for update of pv;
    if not found or v.pst is distinct from 'active' then raise exception 'Product unavailable'; end if;
    if v.price is null or v.price<0 then raise exception 'Invalid product price'; end if;
    if v.stock<r.q then raise exception 'Not enough stock for %',v.pname; end if;
    update product_variants set stock=stock-r.q where id=r.vid;
    insert into order_items(order_id,product_id,variant_id,name,unit_price,qty)
      values(oid,v.product_id,v.id,v.pname||coalesce(' / '||v.color,'')||coalesce(' / '||v.size,''),v.price,r.q);
    sub:=sub+v.price*r.q;
  end loop;
  disc:=case when p_coupon is not null and promo.discount_type='fixed' then least(sub,promo.amount) else round(sub*pct/100,2) end; ship:=case when sub-disc>=5000 then 0 else 250 end;
  update orders set subtotal=sub,discount=disc,shipping=ship,total=sub-disc+ship where id=oid;
  return oid;
end $$;
revoke all on function place_order(jsonb,text,text,text,text,text,uuid) from public,anon;
grant execute on function place_order(jsonb,text,text,text,text,text,uuid) to authenticated;


create or replace function backend_version() returns text language sql stable set search_path=public as $$select '20261002'::text$$;
commit;
