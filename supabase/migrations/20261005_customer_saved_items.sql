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
