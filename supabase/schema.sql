-- Run in Supabase SQL editor. All prices are re-computed on the server in place_order().
create table categories(id uuid primary key default gen_random_uuid(),parent_id uuid references categories on delete set null,name text not null,slug text unique not null,description text,image_url text,status text default 'active',sort_order int default 0,show_in_menu bool default true,show_on_homepage bool default true,seo_title text,seo_description text,created_at timestamptz default now());
create table brands(id uuid primary key default gen_random_uuid(),name text not null,slug text unique not null,logo_url text);
create table products(id uuid primary key default gen_random_uuid(),name text not null,slug text unique not null,short_description text,description text,sku text unique,brand_id uuid references brands,regular_price numeric(10,2) not null check(regular_price>=0),sale_price numeric(10,2) check(sale_price>=0),status text default 'draft',featured bool default false,new_arrival bool default false,best_seller bool default false,seo_title text,seo_description text,created_at timestamptz default now(),updated_at timestamptz default now());
create table product_categories(product_id uuid references products on delete cascade,category_id uuid references categories on delete cascade,primary key(product_id,category_id));
create table product_images(id uuid primary key default gen_random_uuid(),product_id uuid references products on delete cascade,url text not null,alt text,sort_order int default 0);
create table product_variants(id uuid primary key default gen_random_uuid(),product_id uuid references products on delete cascade,sku text unique,color text,size text,price_override numeric(10,2),stock int not null default 0 check(stock>=0));
create table profiles(id uuid primary key references auth.users on delete cascade,full_name text,phone text,role text not null default 'customer');
create table coupons(code text primary key,percent int not null check(percent between 1 and 90),active bool default true);
create table orders(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users,status text default 'pending',subtotal numeric(10,2),discount numeric(10,2),shipping numeric(10,2),total numeric(10,2),name text,phone text,address text,city text,payment_method text default 'cod',coupon_code text,created_at timestamptz default now());
create table order_items(id uuid primary key default gen_random_uuid(),order_id uuid references orders on delete cascade,product_id uuid,variant_id uuid,name text,unit_price numeric(10,2),qty int check(qty>0));
create table blog_posts(id uuid primary key default gen_random_uuid(),title text not null,slug text unique not null,excerpt text,body text,cover_url text,published bool default false,created_at timestamptz default now());
create table newsletter(email text primary key,created_at timestamptz default now());
create index on products(status,created_at desc);create index on product_variants(product_id);create index on product_categories(category_id);create index on orders(user_id);

create function is_admin() returns bool language sql security definer stable set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and role='admin')$$;
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$begin insert into profiles(id,full_name) values(new.id,new.raw_user_meta_data->>'full_name');return new;end$$;
create trigger on_signup after insert on auth.users for each row execute function handle_new_user();

do $$declare t text;begin foreach t in array array['categories','brands','products','product_categories','product_images','product_variants','profiles','coupons','orders','order_items','blog_posts','newsletter'] loop execute format('alter table %I enable row level security',t);end loop;end$$;
-- public catalog reads
create policy pub_cat on categories for select using(status='active' or is_admin());
create policy pub_brand on brands for select using(true);
create policy pub_prod on products for select using(status='active' or is_admin());
create policy pub_pc on product_categories for select using(true);
create policy pub_img on product_images for select using(true);
create policy pub_var on product_variants for select using(true);
create policy pub_blog on blog_posts for select using(published or is_admin());
-- admin writes (no customer can ever write catalog data)
create policy adm_cat on categories for all using(is_admin()) with check(is_admin());
create policy adm_brand on brands for all using(is_admin()) with check(is_admin());
create policy adm_prod on products for all using(is_admin()) with check(is_admin());
create policy adm_pc on product_categories for all using(is_admin()) with check(is_admin());
create policy adm_img on product_images for all using(is_admin()) with check(is_admin());
create policy adm_var on product_variants for all using(is_admin()) with check(is_admin());
create policy adm_blog on blog_posts for all using(is_admin()) with check(is_admin());
create policy adm_coupon on coupons for all using(is_admin()) with check(is_admin());
create policy adm_news on newsletter for select using(is_admin());
create policy news_in on newsletter for insert with check(true);
-- profiles: read own; role can't be changed by the user
create policy prof_r on profiles for select using(id=auth.uid() or is_admin());
create policy prof_u on profiles for update using(id=auth.uid()) with check(id=auth.uid() and role=(select role from profiles where id=auth.uid()));
-- orders: read own, admin manage; creation ONLY through place_order()
create policy ord_r on orders for select using(user_id=auth.uid() or is_admin());
create policy ord_u on orders for update using(is_admin());
create policy oi_r on order_items for select using(exists(select 1 from orders o where o.id=order_id and (o.user_id=auth.uid() or is_admin())));

create function place_order(items jsonb,p_name text,p_phone text,p_address text,p_city text,p_coupon text default null) returns uuid language plpgsql security definer set search_path=public as $$
declare oid uuid;sub numeric:=0;pct int:=0;disc numeric;ship numeric;r record;v record;unit numeric;
begin
 if auth.uid() is null then raise exception 'Sign in to place an order';end if;
 if jsonb_array_length(items)=0 then raise exception 'Cart is empty';end if;
 if p_coupon is not null then select percent into pct from coupons where code=upper(p_coupon) and active;pct:=coalesce(pct,0);end if;
 insert into orders(user_id,name,phone,address,city,coupon_code) values(auth.uid(),p_name,p_phone,p_address,p_city,upper(p_coupon)) returning id into oid;
 for r in select (e->>'variant_id')::uuid vid,(e->>'qty')::int q from jsonb_array_elements(items) e loop
  if r.q<1 or r.q>20 then raise exception 'Invalid quantity';end if;
  select pv.*,p.name pname,p.status pst,coalesce(pv.price_override,p.sale_price,p.regular_price) price into v from product_variants pv join products p on p.id=pv.product_id where pv.id=r.vid for update of pv;
  if not found or v.pst<>'active' then raise exception 'Product unavailable';end if;
  if v.stock<r.q then raise exception 'Not enough stock for %',v.pname;end if;
  update product_variants set stock=stock-r.q where id=r.vid;
  insert into order_items(order_id,product_id,variant_id,name,unit_price,qty) values(oid,v.product_id,v.id,v.pname||coalesce(' / '||v.color,'')||coalesce(' / '||v.size,''),v.price,r.q);
  sub:=sub+v.price*r.q;
 end loop;
 disc:=round(sub*pct/100);ship:=case when sub-disc>=5000 then 0 else 250 end;
 update orders set subtotal=sub,discount=disc,shipping=ship,total=sub-disc+ship where id=oid;
 return oid;
end$$;
revoke all on function place_order from public,anon;grant execute on function place_order to authenticated;

insert into storage.buckets(id,name,public) values('media','media',true) on conflict do nothing;
create policy media_r on storage.objects for select using(bucket_id='media');
create policy media_w on storage.objects for insert with check(bucket_id='media' and is_admin());
create policy media_d on storage.objects for delete using(bucket_id='media' and is_admin());
-- After signing up, make yourself admin:  update profiles set role='admin' where id='<your auth user id>';

-- Reliability and access-control fixes (also provided separately for existing databases).
-- Apply once to existing installations. Fresh installations already include this in schema.sql.
begin;

alter table orders add column request_id uuid;
alter table orders add column request_payload jsonb;
create unique index orders_request_id on orders(user_id, request_id);
-- NOT VALID preserves historical rows while enforcing the rule on new writes.
alter table product_variants add constraint variant_price_nonnegative
  check (price_override >= 0) not valid;
alter table orders add constraint order_status_valid
  check (status is not null and status in ('pending','confirmed','shipped','delivered','cancelled')) not valid;

alter policy pub_pc on product_categories using (
  is_admin() or exists(select 1 from products p where p.id=product_id and p.status='active'));
alter policy pub_img on product_images using (
  is_admin() or exists(select 1 from products p where p.id=product_id and p.status='active'));
alter policy pub_var on product_variants using (
  is_admin() or exists(select 1 from products p where p.id=product_id and p.status='active'));

-- Column grants prevent customers changing their role without a self-referencing policy.
alter policy prof_u on profiles using (id=auth.uid()) with check (id=auth.uid());
revoke update on profiles from public, anon, authenticated;
grant update(full_name,phone) on profiles to authenticated;
revoke update on orders from public, anon, authenticated;
grant update(status) on orders to authenticated;

create function restore_cancelled_stock() returns trigger
language plpgsql security definer set search_path=public as $$
declare r record;
begin
  if old.status='cancelled' and new.status is distinct from old.status then
    raise exception 'Cancelled orders cannot be reopened';
  end if;
  if new.status='cancelled' and old.status is distinct from 'cancelled' then
    for r in select variant_id,sum(qty)::int quantity from order_items
      where order_id=old.id group by variant_id order by variant_id loop
      update product_variants set stock=stock+r.quantity where id=r.variant_id;
    end loop;
  end if;
  return new;
end $$;
create trigger order_cancelled before update of status on orders
  for each row execute function restore_cancelled_stock();

drop function place_order(jsonb,text,text,text,text,text);
create function place_order(items jsonb,p_name text,p_phone text,p_address text,p_city text,
  p_coupon text default null,p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare oid uuid; sub numeric:=0; pct int:=0; disc numeric; ship numeric;
  r record; v record; payload jsonb; previous jsonb;
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
    select percent into pct from coupons where code=p_coupon and active;
    if not found then raise exception 'Coupon is invalid or inactive'; end if;
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
  disc:=round(sub*pct/100,2); ship:=case when sub-disc>=5000 then 0 else 250 end;
  update orders set subtotal=sub,discount=disc,shipping=ship,total=sub-disc+ship where id=oid;
  return oid;
end $$;
revoke all on function place_order(jsonb,text,text,text,text,text,uuid) from public,anon;
grant execute on function place_order(jsonb,text,text,text,text,text,uuid) to authenticated;

-- All catalog rows are committed together. A retry with the same ID is safe.
create function create_product(p_id uuid,p_product jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare price numeric; sale numeric; quantity int; product_name text; product_slug text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_id is null then raise exception 'Missing product ID'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
  if exists(select 1 from products where id=p_id) then return p_id; end if;
  product_name:=btrim(p_product->>'name'); product_slug:=btrim(p_product->>'slug');
  if coalesce(length(product_name),0) not between 1 and 200
    or coalesce(product_slug,'') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Enter a valid product name and slug'; end if;
  if coalesce(p_product->>'price','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
    or coalesce(p_product->>'stock','') !~ '^[0-9]+$' then raise exception 'Invalid price or stock'; end if;
  price:=(p_product->>'price')::numeric; quantity:=(p_product->>'stock')::int;
  if nullif(p_product->>'sale','') is not null then
    if (p_product->>'sale') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Invalid sale price'; end if;
    sale:=(p_product->>'sale')::numeric;
    if sale>price then raise exception 'Sale price cannot exceed regular price'; end if;
  end if;
  insert into products(id,name,slug,description,regular_price,sale_price,status)
    values(p_id,product_name,product_slug,p_product->>'desc',price,sale,'active');
  if nullif(p_product->>'cat','') is not null then
    insert into product_categories values(p_id,(p_product->>'cat')::uuid);
  end if;
  insert into product_variants(product_id,color,size,stock)
    values(p_id,nullif(btrim(p_product->>'color'),''),nullif(btrim(p_product->>'size'),''),quantity);
  if nullif(p_product->>'image_url','') is not null then
    insert into product_images(product_id,url,alt) values(p_id,p_product->>'image_url',product_name);
  end if;
  return p_id;
end $$;
revoke all on function create_product(uuid,jsonb) from public,anon;
grant execute on function create_product(uuid,jsonb) to authenticated;
commit;

-- Store backend management and explicit grants.
-- Run after 20260930_reliability.sql on existing databases.
begin;

-- Make grants explicit rather than relying on project-wide default privileges.
grant usage on schema public to anon, authenticated;
grant select on categories,brands,products,product_categories,product_images,product_variants,blog_posts to anon,authenticated;
grant insert,update,delete on categories,brands,products,product_categories,product_images,product_variants,blog_posts,coupons to authenticated;
grant select on profiles,orders,order_items,coupons,newsletter to authenticated;
grant insert on newsletter to anon,authenticated;
grant update(full_name,phone) on profiles to authenticated;
grant update(status) on orders to authenticated;

insert into profiles(id,full_name)
  select id,raw_user_meta_data->>'full_name' from auth.users
  on conflict(id) do nothing;

update storage.buckets set file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','image/gif','image/avif']
  where id='media';

create function touch_product() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at:=clock_timestamp();return new;end $$;
create trigger product_updated before update on products for each row execute function touch_product();

create function backend_version() returns text language sql stable set search_path=public
  as $$select '20261001'::text$$;
grant execute on function backend_version() to anon,authenticated;

create function save_product(p_id uuid,p_product jsonb,p_variants jsonb,
  p_create_only bool default false,p_expected_updated_at timestamptz default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare existing products; variant product_variants; entry jsonb; category jsonb;
  product_name text; product_slug text; regular numeric; sale numeric; quantity int; override_price numeric; vid uuid;
begin
  if not is_admin() then raise exception 'Admins only';end if;
  if p_id is null then raise exception 'Missing product ID';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,1));
  select * into existing from products where id=p_id for update;
  if found then
    if p_create_only then return p_id;end if;
    if p_expected_updated_at is null or existing.updated_at is distinct from p_expected_updated_at then
      raise exception 'This product changed. Reload it before saving';
    end if;
  elsif not p_create_only then raise exception 'Product no longer exists';
  end if;
  product_name:=btrim(p_product->>'name');product_slug:=btrim(p_product->>'slug');
  if coalesce(length(product_name),0) not between 1 and 200
    or coalesce(product_slug,'') !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'Invalid product name or slug';end if;
  if coalesce(p_product->>'regular_price','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Invalid regular price';end if;
  regular:=(p_product->>'regular_price')::numeric;
  if nullif(p_product->>'sale_price','') is not null then
    if (p_product->>'sale_price') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Invalid sale price';end if;
    sale:=(p_product->>'sale_price')::numeric;
    if sale>regular then raise exception 'Sale price cannot exceed regular price';end if;
  end if;
  if coalesce(p_product->>'status','') not in ('active','draft') then raise exception 'Invalid product status';end if;
  if jsonb_typeof(p_variants) is distinct from 'array' then raise exception 'Invalid variants';end if;
  if jsonb_array_length(p_variants) not between 1 and 100 then raise exception 'Add 1 to 100 variants';end if;
  if jsonb_typeof(p_product->'category_ids') is distinct from 'array' then raise exception 'Invalid categories';end if;
  if (select count(*) from jsonb_array_elements(p_variants))<>(select count(distinct v->>'id') from jsonb_array_elements(p_variants) v) then raise exception 'Variant IDs must be unique';end if;

  insert into products(id,name,slug,short_description,description,brand_id,regular_price,sale_price,status,seo_title,seo_description)
    values(p_id,product_name,product_slug,p_product->>'short_description',p_product->>'description',
      nullif(p_product->>'brand_id','')::uuid,regular,sale,p_product->>'status',p_product->>'seo_title',p_product->>'seo_description')
    on conflict(id) do update set name=excluded.name,slug=excluded.slug,short_description=excluded.short_description,
      description=excluded.description,brand_id=excluded.brand_id,regular_price=excluded.regular_price,
      sale_price=excluded.sale_price,status=excluded.status,seo_title=excluded.seo_title,seo_description=excluded.seo_description;
  delete from product_categories where product_id=p_id;
  for category in select value from jsonb_array_elements(p_product->'category_ids') loop
    insert into product_categories(product_id,category_id) values(p_id,(category#>>'{}')::uuid) on conflict do nothing;
  end loop;
  -- Never silently delete historical variants. Set stock to zero to stop sales.
  for entry in select value from jsonb_array_elements(p_variants) order by value->>'id' loop
    vid:=(entry->>'id')::uuid;
    if vid is null or coalesce(entry->>'stock','') !~ '^[0-9]+$' then raise exception 'Invalid variant or stock';end if;
    quantity:=(entry->>'stock')::int;override_price:=null;
    if nullif(entry->>'price_override','') is not null then
      if (entry->>'price_override') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Invalid variant price';end if;
      override_price:=(entry->>'price_override')::numeric;
    end if;
    select * into variant from product_variants where id=vid for update;
    if found then
      if variant.product_id<>p_id then raise exception 'Variant belongs to another product';end if;
      if nullif(entry->>'expected_stock','') is null or variant.stock<>(entry->>'expected_stock')::int then
        raise exception 'Stock changed while editing. Reload the product before saving';
      end if;
      update product_variants set color=nullif(entry->>'color',''),size=nullif(entry->>'size',''),stock=quantity,price_override=override_price where id=vid;
    else
      insert into product_variants(id,product_id,color,size,stock,price_override)
        values(vid,p_id,nullif(entry->>'color',''),nullif(entry->>'size',''),quantity,override_price);
    end if;
  end loop;
  if nullif(p_product->>'image_url','') is not null and not exists(select 1 from product_images where product_id=p_id and url=p_product->>'image_url') then
    insert into product_images(product_id,url,alt,sort_order)
      select p_id,p_product->>'image_url',product_name,coalesce(min(sort_order),0)-1 from product_images where product_id=p_id;
  end if;
  return p_id;
end $$;
revoke all on function save_product(uuid,jsonb,jsonb,bool,timestamptz) from public,anon;
grant execute on function save_product(uuid,jsonb,jsonb,bool,timestamptz) to authenticated;
commit;

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

-- Run once in Supabase SQL Editor. Preserves existing products, users and orders.
begin;
create table public.customer_saved_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('cart','wishlist')),
  payload jsonb not null default '[]'::jsonb check (jsonb_typeof(payload)='array' and jsonb_array_length(payload)<=100),
  version bigint not null default 1,
  primary key(user_id,kind)
);
alter table public.customer_saved_items enable row level security;
revoke all on public.customer_saved_items from public,anon,authenticated;
grant select on public.customer_saved_items to authenticated;
create policy saved_items_owner on public.customer_saved_items for select to authenticated using(user_id=auth.uid());
create function public.save_customer_items(p_kind text,p_payload jsonb,p_expected_version bigint) returns bigint
language plpgsql security definer set search_path=public as $$
declare current_version bigint; next_version bigint; entry jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to save items'; end if;
  if p_kind is null or p_kind not in ('cart','wishlist') or p_payload is null
    or jsonb_typeof(p_payload) is distinct from 'array' then raise exception 'Invalid saved items'; end if;
  if jsonb_array_length(p_payload)>100 then raise exception 'You can save up to 100 items'; end if;
  for entry in select value from jsonb_array_elements(p_payload) loop
    if p_kind='cart' then
      if jsonb_typeof(entry) is distinct from 'object'
        or coalesce(entry->>'variant_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(entry->>'qty','') !~ '^([1-9]|1[0-9]|20)$'
        or jsonb_typeof(entry->'name') is distinct from 'string'
        or length(entry->>'name')>1000
        or jsonb_typeof(entry->'price') is distinct from 'number' then raise exception 'Invalid cart item'; end if;
      if (entry->>'price')::numeric<0 then raise exception 'Invalid price'; end if;
    else
      if jsonb_typeof(entry) is distinct from 'string' or (entry#>>'{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Invalid favourite'; end if;
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_kind,61005));
  select version into current_version from customer_saved_items where user_id=auth.uid() and kind=p_kind;
  if p_expected_version is distinct from coalesce(current_version,0) then raise exception 'Saved items changed on another page. Refresh and try again'; end if;
  next_version:=coalesce(current_version,0)+1;
  insert into customer_saved_items(user_id,kind,payload,version) values(auth.uid(),p_kind,p_payload,next_version)
    on conflict(user_id,kind) do update set payload=excluded.payload,version=excluded.version;
  return next_version;
end $$;
revoke all on function public.save_customer_items(text,jsonb,bigint) from public,anon;
grant execute on function public.save_customer_items(text,jsonb,bigint) to authenticated;
commit;
