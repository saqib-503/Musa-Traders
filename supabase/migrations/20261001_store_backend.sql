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
