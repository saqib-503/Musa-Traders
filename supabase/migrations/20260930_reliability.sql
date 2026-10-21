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
