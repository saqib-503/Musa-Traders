-- Run once after 20261008_payment_methods.sql.
-- Converts the catalogue editor into a clean ride-on-car catalogue without deleting existing products.
begin;

alter table products add column model_number text;
alter table products add column recommended_age text;
alter table products add column max_load_kg numeric(8,2);
alter table products add column charging_time_hours numeric(6,2);
alter table products add column warranty_text text;
alter table products add column safety_information text;
alter table products add column box_contents text;
alter table products add column material text;
alter table products add column product_dimensions_cm text;
alter table products add column carton_dimensions_cm text;
alter table products add column cbm numeric(10,4);
alter table products add column net_weight_kg numeric(8,2);
alter table products add column gross_weight_kg numeric(8,2);
alter table products add column pieces_per_carton int;
alter table products add column quantity_40hq int;
alter table products add column fob_usd numeric(10,2);
alter table products add column landed_cost_pkr numeric(12,2);
alter table products add column exchange_rate numeric(10,4);
alter table products add column supplier_name text;
alter table products add column minimum_order_quantity int;
alter table products add column import_notes text;
alter table products add column technical_specs jsonb not null default '{}'::jsonb;
alter table product_variants add column configuration text;

create table product_addons (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references products on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 120), description text,
 price_adjustment numeric(10,2) not null default 0 check(price_adjustment>=0),
 active boolean not null default true, sort_order int not null default 0
);
create index product_addons_product on product_addons(product_id,sort_order);
alter table product_addons enable row level security;
create policy product_addons_read on product_addons for select using(is_admin() or (active and exists(select 1 from products p where p.id=product_id and p.status='active')));
create policy product_addons_admin on product_addons for all using(is_admin()) with check(is_admin());
grant select on product_addons to anon,authenticated;
grant insert,update,delete on product_addons to authenticated;

-- Keep old `size` values as historical data, but new data uses a clear configuration label.
update product_variants set configuration=nullif(size,'') where configuration is null and nullif(size,'') is not null;

alter function save_product(uuid,jsonb,jsonb,bool,timestamptz) rename to save_product_catalog_base;
revoke all on function save_product_catalog_base(uuid,jsonb,jsonb,bool,timestamptz) from public,anon,authenticated;
create function save_product(p_id uuid,p_product jsonb,p_variants jsonb,
  p_create_only bool default false,p_expected_updated_at timestamptz default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid; item jsonb; position int:=0;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  result:=save_product_catalog_base(p_id,p_product,p_variants,p_create_only,p_expected_updated_at);
  update products set
    model_number=nullif(btrim(p_product->>'model_number'),''),
    recommended_age=nullif(btrim(p_product->>'recommended_age'),''),
    max_load_kg=nullif(p_product->>'max_load_kg','')::numeric,
    charging_time_hours=nullif(p_product->>'charging_time_hours','')::numeric,
    warranty_text=nullif(btrim(p_product->>'warranty_text'),''), safety_information=nullif(btrim(p_product->>'safety_information'),''),
    box_contents=nullif(btrim(p_product->>'box_contents'),''), material=nullif(btrim(p_product->>'material'),''),
    product_dimensions_cm=nullif(btrim(p_product->>'product_dimensions_cm'),''), carton_dimensions_cm=nullif(btrim(p_product->>'carton_dimensions_cm'),''),
    cbm=nullif(p_product->>'cbm','')::numeric, net_weight_kg=nullif(p_product->>'net_weight_kg','')::numeric,
    gross_weight_kg=nullif(p_product->>'gross_weight_kg','')::numeric, pieces_per_carton=nullif(p_product->>'pieces_per_carton','')::int,
    quantity_40hq=nullif(p_product->>'quantity_40hq','')::int, fob_usd=nullif(p_product->>'fob_usd','')::numeric,
    landed_cost_pkr=nullif(p_product->>'landed_cost_pkr','')::numeric, exchange_rate=nullif(p_product->>'exchange_rate','')::numeric,
    supplier_name=nullif(btrim(p_product->>'supplier_name'),''), minimum_order_quantity=nullif(p_product->>'minimum_order_quantity','')::int,
    import_notes=nullif(btrim(p_product->>'import_notes'),''), technical_specs=coalesce(p_product->'technical_specs','{}'::jsonb)
    where id=p_id;
  for item in select value from jsonb_array_elements(p_variants) loop
    update product_variants set configuration=nullif(btrim(item->>'configuration'),'') where id=(item->>'id')::uuid and product_id=p_id;
  end loop;
  if p_product ? 'addons' then
    if jsonb_typeof(p_product->'addons') is distinct from 'array' or jsonb_array_length(p_product->'addons')>30 then raise exception 'Use 0 to 30 add-ons'; end if;
    delete from product_addons where product_id=p_id;
    for item in select value from jsonb_array_elements(p_product->'addons') loop
      if coalesce(length(btrim(item->>'name')),0) not between 1 and 120 or coalesce(item->>'price_adjustment','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Invalid add-on'; end if;
      insert into product_addons(product_id,name,description,price_adjustment,active,sort_order)
      values(p_id,btrim(item->>'name'),nullif(btrim(item->>'description'),''),(item->>'price_adjustment')::numeric,
        coalesce((item->>'active')::boolean,true),position);
      position:=position+1;
    end loop;
  end if;
  return result;
end $$;
revoke all on function save_product(uuid,jsonb,jsonb,bool,timestamptz) from public,anon;
grant execute on function save_product(uuid,jsonb,jsonb,bool,timestamptz) to authenticated;

create or replace function backend_version() returns text language sql stable set search_path=public as $$select '20261009'::text$$;
commit;
