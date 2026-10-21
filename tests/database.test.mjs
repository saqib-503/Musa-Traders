import { PGlite } from '@electric-sql/pglite';
import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const db = new PGlite();
const ids = {
  customer: '10000000-0000-4000-8000-000000000001',
  admin: '10000000-0000-4000-8000-000000000002',
  other: '10000000-0000-4000-8000-000000000003',
  product: '20000000-0000-4000-8000-000000000001',
  draft: '20000000-0000-4000-8000-000000000002',
  variant: '30000000-0000-4000-8000-000000000001',
  draftVariant: '30000000-0000-4000-8000-000000000002',
  category: '40000000-0000-4000-8000-000000000001',
  request: '50000000-0000-4000-8000-000000000001',
  created: '60000000-0000-4000-8000-000000000001',
};
const bootstrap = `
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth,storage to anon,authenticated;
  grant execute on function auth.uid() to anon,authenticated;
  alter default privileges in schema public grant all on tables to anon,authenticated;
  create table storage.buckets(id text primary key,name text,public bool,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text);
  alter table storage.objects enable row level security;
`;
async function role(who = 'customer', sqlRole = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids[who] || '']);
  await db.exec(`set role ${sqlRole}`);
}
async function scalar(sql, params = []) { return Object.values((await db.query(sql, params)).rows[0])[0]; }
async function place({ items = [{ variant_id: ids.variant, qty: 2 }], name = 'Buyer', phone = '03001234567', address = 'Street 1', city = 'Lahore', coupon = null, request = ids.request } = {}) {
  return scalar('select place_order($1::jsonb,$2,$3,$4,$5,$6,$7::uuid)', [items === null ? null : JSON.stringify(items), name, phone, address, city, coupon, request]);
}
const productInput = { name: 'New item', slug: 'new-item', price: '500', sale: '', stock: '7', cat: ids.category, color: 'Blue', size: 'S', desc: 'Description', image_url: 'https://example.test/image.png' };
async function create(input = productInput) {
  return scalar('select create_product($1::uuid,$2::jsonb)', [ids.created, JSON.stringify(input)]);
}

before(async () => {
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../supabase/migrations/20260930_reliability.sql', import.meta.url), 'utf8');
  assert.ok(schema.replace(/\r/g, "").includes(migration.replace(/\r/g, "")), 'fresh and upgrade schemas must stay synchronized');
  const adminMigration=await readFile(new URL('../supabase/migrations/20261002_admin_features.sql',import.meta.url),'utf8');
  assert.ok(schema.replace(/\r/g, "").includes(adminMigration.replace(/\r/g, "")), 'admin upgrade and fresh schema must stay synchronized');
  await db.exec(bootstrap);
  await db.exec(schema);
  for (const user of ['customer','admin','other']) await db.query('insert into auth.users(id) values($1)', [ids[user]]);
  await db.query("update profiles set role='admin' where id=$1", [ids.admin]);
});
beforeEach(async () => {
  await db.exec('reset role; truncate orders,products,categories,coupons cascade');
  await db.query("insert into categories(id,name,slug) values($1,'Clothes','clothes')", [ids.category]);
  await db.query("insert into products(id,name,slug,regular_price,sale_price,status) values($1,'Active','active',1000,800,'active'),($2,'Draft','draft',1000,null,'draft')", [ids.product,ids.draft]);
  await db.query('insert into product_variants(id,product_id,stock) values($1,$2,30),($3,$4,30)', [ids.variant,ids.product,ids.draftVariant,ids.draft]);
  await db.query('insert into product_categories values($1,$3),($2,$3)', [ids.product,ids.draft,ids.category]);
  await db.query("insert into product_images(product_id,url) values($1,'active.png'),($2,'draft.png')", [ids.product,ids.draft]);
  await role();
});
after(() => db.close());

test('server computes prices, locks/decrements stock, and applies shipping', async () => {
  const id = await place();
  const order = (await db.query('select subtotal,discount,shipping,total from orders where id=$1',[id])).rows[0];
  assert.deepEqual(order, { subtotal:'1600.00', discount:'0.00', shipping:'250.00', total:'1850.00' });
  assert.equal(await scalar('select stock from product_variants where id=$1',[ids.variant]),28);
});
test('same request retries return one order without consuming more stock', async () => {
  assert.equal(await place(), await place());
  assert.equal(await scalar('select count(*)::int from orders'),1);
  assert.equal(await scalar('select stock from product_variants where id=$1',[ids.variant]),28);
  await assert.rejects(place({city:'Karachi'}),/already used/);
});
test('request IDs are scoped to each customer', async () => {
  const first = await place(); await role('other'); const second = await place();
  assert.notEqual(first,second);
  assert.equal(await scalar('select count(*)::int from orders'),1);
});
test('null, empty, non-array and malformed carts leave no order behind', async () => {
  for (const items of [null,[],{},[{variant_id:ids.variant}],[{variant_id:ids.variant,qty:null}],[{variant_id:'bad',qty:1}],[{variant_id:ids.variant,qty:1.5}]])
    await assert.rejects(place({items}));
  assert.equal(await scalar('select count(*)::int from orders'),0);
});
test('delivery fields and invalid coupons are rejected', async () => {
  for (const fields of [{name:''},{phone:'1'},{address:null},{city:' '},{coupon:'MISSING'}]) await assert.rejects(place(fields));
  assert.equal(await scalar('select count(*)::int from orders'),0);
});
test('duplicate variants cannot bypass the quantity limit', async () => {
  await assert.rejects(place({items:[{variant_id:ids.variant,qty:15},{variant_id:ids.variant,qty:10}]}),/Quantity/);
  assert.equal(await scalar('select stock from product_variants where id=$1',[ids.variant]),30);
});
test('failed order rolls back earlier stock updates and order rows', async () => {
  await assert.rejects(place({items:[{variant_id:ids.variant,qty:1},{variant_id:ids.draftVariant,qty:1}]}),/unavailable/);
  assert.equal(await scalar('select stock from product_variants where id=$1',[ids.variant]),30);
  assert.equal(await scalar('select count(*)::int from orders'),0);
});
test('insufficient stock rejects the whole order', async () => {
  await db.exec('reset role'); await db.query('update product_variants set stock=1 where id=$1',[ids.variant]); await role();
  await assert.rejects(place(),/Not enough stock/);
  assert.equal(await scalar('select count(*)::int from orders'),0);
});
test('coupons round to cents and shipping uses discounted subtotal', async () => {
  await db.exec("reset role; insert into coupons values('SAVE',10,true)");
  await db.query('update product_variants set price_override=5555.55 where id=$1',[ids.variant]); await role();
  const id = await place({items:[{variant_id:ids.variant,qty:1}],coupon:' save '});
  assert.deepEqual((await db.query('select discount,shipping,total from orders where id=$1',[id])).rows[0],{discount:'555.56',shipping:'250.00',total:'5249.99'});
});
test('free shipping applies at the threshold', async () => {
  await db.exec('reset role'); await db.query('update product_variants set price_override=2500 where id=$1',[ids.variant]); await role();
  const id=await place(); assert.equal(await scalar('select shipping from orders where id=$1',[id]),'0.00');
});
test('admin cancellation restores stock exactly once and cannot reopen', async () => {
  const id = await place(); await role('admin');
  await db.query("update orders set status='cancelled' where id=$1",[id]);
  await db.query("update orders set status='cancelled' where id=$1",[id]);
  assert.equal(await scalar('select stock from product_variants where id=$1',[ids.variant]),30);
  await assert.rejects(db.query("update orders set status='pending' where id=$1",[id]),/cannot be reopened/);
});
test('customers cannot cancel orders or change order totals', async () => {
  const id = await place();
  assert.equal((await db.query("update orders set status='cancelled' where id=$1",[id])).affectedRows,0);
  await assert.rejects(db.query('update orders set total=1 where id=$1',[id]),/permission denied/);
});
test('profile updates work but role escalation is forbidden', async () => {
  assert.equal((await db.query("update profiles set full_name='Updated' where id=$1",[ids.customer])).affectedRows,1);
  await assert.rejects(db.query("update profiles set role='admin' where id=$1",[ids.customer]),/permission denied/);
  assert.equal(await scalar('select is_admin()'),false);
});
test('anonymous catalog reads hide all draft product relations', async () => {
  await role('none','anon');
  for (const table of ['products','product_variants','product_images','product_categories']) assert.equal(await scalar(`select count(*)::int from ${table}`),1,table);
  await assert.rejects(place(),/permission denied/);
});
test('admins can read drafts; customers cannot write catalog or orders directly', async () => {
  await assert.rejects(db.query("insert into products(name,slug,regular_price) values('Bad','bad',1)"),/row-level security/);
  await assert.rejects(db.query('insert into orders(user_id) values($1)',[ids.customer]),/row-level security/);
  await role('admin'); assert.equal(await scalar('select count(*)::int from product_variants'),2);
});
test('negative override prices and unknown order statuses are rejected', async () => {
  const id=await place(); await role('admin');
  await assert.rejects(db.query('update product_variants set price_override=-1 where id=$1',[ids.variant]),/variant_price_nonnegative/);
  await assert.rejects(db.query("update orders set status='invalid' where id=$1",[id]),/order_status_valid/);
});
test('atomic product creation saves every related row and retries safely', async () => {
  await role('admin'); assert.equal(await create(),ids.created); assert.equal(await create(),ids.created);
  for (const table of ['product_variants','product_images','product_categories']) assert.equal(await scalar(`select count(*)::int from ${table} where product_id=$1`,[ids.created]),1,table);
});
test('a failed category relation rolls back the new product entirely', async () => {
  await role('admin'); await assert.rejects(create({...productInput,cat:ids.other}),/foreign key/);
  assert.equal(await scalar('select count(*)::int from products where id=$1',[ids.created]),0);
});
test('product creation rejects non-admins and invalid values', async () => {
  await assert.rejects(create(),/Admins only/); await role('admin');
  for (const fields of [{price:'-1'},{stock:'1.5'},{sale:'501'},{name:' '},{slug:''}]) await assert.rejects(create({...productInput,...fields}));
  assert.equal(await scalar('select count(*)::int from products where id=$1',[ids.created]),0);
});
test('upgrade migration preserves an existing installation and its records', async () => {
  const upgrade = new PGlite();
  try {
    const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8');
    const migration=await readFile(new URL('../supabase/migrations/20260930_reliability.sql',import.meta.url),'utf8');
    await upgrade.exec(bootstrap);
    await upgrade.exec(schema.split('-- Reliability and access-control fixes')[0]);
    await upgrade.exec("insert into products(name,slug,regular_price) values('Existing','existing',123)");
    await upgrade.exec(migration);
    await upgrade.exec(await readFile(new URL("../supabase/migrations/20261001_store_backend.sql",import.meta.url),"utf8"));
    await upgrade.exec(await readFile(new URL("../supabase/migrations/20261002_admin_features.sql",import.meta.url),"utf8"));
    assert.equal((await upgrade.query("select regular_price from products where slug='existing'")).rows[0].regular_price,'123.00');
  } finally { await upgrade.close(); }
});

test('fixed discounts cap at subtotal and honor limits without consuming retry usage',async()=>{
 await role('admin');await db.exec("insert into coupons(code,discount_type,amount,usage_limit) values('FIXED','fixed',2000,1)");await role();
 const id=await place({coupon:'FIXED'});assert.equal(await scalar('select discount from orders where id=$1',[id]),'1600.00');
 assert.equal(await scalar('select total from orders where id=$1',[id]),'250.00');assert.equal(await place({coupon:'FIXED'}),id);
 await role('other');await assert.rejects(place({coupon:'FIXED'}),/usage limit/);
});

test('future and expired coupons reject checkout without stock changes',async()=>{
 await role('admin');await db.exec("insert into coupons(code,percent,starts_at) values('FUTURE',10,now()+interval '1 day');insert into coupons(code,percent,ends_at) values('EXPIRED',10,now()-interval '1 day')");await role();
 await assert.rejects(place({coupon:'FUTURE'}),/not started/);await assert.rejects(place({coupon:'EXPIRED'}),/expired/);
 assert.equal(await scalar('select stock from product_variants where id=$1',[ids.variant]),30);
});

test('extended editor saves images, SKUs, flags and related products atomically',async()=>{
 await role('admin');await saveManaged({...managedInput,sku:'STORE-01',tags:['cotton','baby'],featured:true,new_arrival:true,images:[{url:'https://example.test/a.png',alt:'Cover'},{url:'https://example.test/b.png',alt:'Back'}],related_product_ids:[ids.product]},[{...managedVariant,sku:'VARIANT-01'}]);
 assert.equal(await scalar('select sku from products where id=$1',[ids.created]),'STORE-01');
 assert.equal(await scalar('select featured from products where id=$1',[ids.created]),true);
 assert.equal(await scalar('select count(*)::int from product_images where product_id=$1',[ids.created]),2);
 assert.equal(await scalar('select count(*)::int from related_products where product_id=$1',[ids.created]),1);
 const timestamp=await scalar('select updated_at::text from products where id=$1',[ids.created]);
 await assert.rejects(saveManaged({...managedInput,name:'Invalid save',images:[{url:'javascript:bad'}]},[{...managedVariant,expected_stock:10}],false,timestamp),/Invalid image/);
 assert.equal(await scalar('select name from products where id=$1',[ids.created]),managedInput.name);
 assert.equal(await scalar('select count(*)::int from product_images where product_id=$1',[ids.created]),2);
 await assert.rejects(scalar('select save_product_base($1,$2,$3,true,null)',[ids.created,JSON.stringify(managedInput),JSON.stringify([managedVariant])]),/permission denied/);
});

test('users and analytics RPCs require admin and role changes cannot escalate or demote self',async()=>{
 await assert.rejects(scalar('select admin_users()'),/Admins only/);await assert.rejects(scalar('select admin_analytics()'),/Admins only/);
 await assert.rejects(scalar("select admin_set_role($1,'admin')",[ids.customer]),/Admins only/);
 await role('admin');const users=await scalar('select admin_users()');assert.equal(users.total,3);
 await assert.rejects(scalar("select admin_set_role($1,'customer')",[ids.admin]),/own role/);
 await scalar("select admin_set_role($1,'admin')",[ids.other]);await role('other');assert.equal(await scalar('select is_admin()'),true);
 await role('admin');await scalar("select admin_set_role($1,'customer')",[ids.other]);
});

test('reviews require a delivered purchase and stay private until approved',async()=>{
 const insert=()=>scalar("insert into product_reviews(product_id,user_id,rating,title,body) values($1,$2,5,'Good','Soft cotton') returning id",[ids.product,ids.customer]);
 await assert.rejects(insert(),/row-level security/);const order=await place();await role('admin');await db.query("update orders set status='delivered' where id=$1",[order]);await role();const review=await insert();
 assert.equal((await db.query('update product_reviews set approved=true where id=$1',[review])).affectedRows,0);
 assert.equal(await scalar('select approved from product_reviews where id=$1',[review]),false);
 await role('none','anon');assert.equal(await scalar('select count(*)::int from product_reviews'),0);
 await role('admin');await db.query('update product_reviews set approved=true where id=$1',[review]);await role('none','anon');assert.equal(await scalar('select count(*)::int from product_reviews'),1);
 await role('admin');await db.query('update product_reviews set approved=false where id=$1',[review]);await role('none','anon');assert.equal(await scalar('select count(*)::int from product_reviews'),0);
});

test('status notifications are private and customers can only mark their own as read',async()=>{
 const order=await place();await role('admin');await db.query("update orders set status='confirmed' where id=$1",[order]);
 await role();assert.equal(await scalar('select count(*)::int from notifications'),1);await db.exec('update notifications set read_at=now()');
 await assert.rejects(db.exec("update notifications set message='Fake'"),/permission denied/);
 await role('other');assert.equal(await scalar('select count(*)::int from notifications'),0);
});

test('analytics counts delivered value separately from open and cancelled orders',async()=>{
 const delivered=await place();await role('admin');await db.query("update orders set status='delivered' where id=$1",[delivered]);await role('other');const cancelled=await place();await role('admin');await db.query("update orders set status='cancelled' where id=$1",[cancelled]);
 const stats=await scalar('select admin_analytics()');assert.equal(stats.orders,2);assert.equal(stats.delivered_revenue,1850);assert.equal(stats.average_order,1850);assert.equal(stats.open_value,0);assert.equal(stats.top_products[0].quantity,2);assert.equal(stats.daily.length,1);
});

test('ordered products cannot be deleted and draft related products stay hidden',async()=>{
 await place();await role('admin');await assert.rejects(db.query('delete from products where id=$1',[ids.product]),/order history/);
 await db.query('insert into related_products values($1,$2)',[ids.product,ids.draft]);await role('none','anon');assert.equal(await scalar('select count(*)::int from related_products'),0);
});

const managedInput = {name:'Managed product',slug:'managed-product',regular_price:'1000',sale_price:'800',brand_id:'',status:'active',category_ids:[ids.category],description:'Details',short_description:'Short description'};
const managedVariant = {id:'70000000-0000-4000-8000-000000000001',stock:'10',color:'Blue',size:'S',price_override:''};
async function saveManaged(input=managedInput,variants=[managedVariant],createOnly=true,updatedAt=null) {
  return scalar('select save_product($1::uuid,$2::jsonb,$3::jsonb,$4::bool,$5::timestamptz)',[ids.created,JSON.stringify(input),JSON.stringify(variants),createOnly,updatedAt]);
}
test('backend version and bucket upload limits are configured',async()=>{
 assert.equal(await scalar('select backend_version()'),'20261002');
 await db.exec('reset role');
 const bucket=(await db.query("select file_size_limit,allowed_mime_types from storage.buckets where id='media'")).rows[0];
 assert.equal(Number(bucket.file_size_limit),5242880);assert.ok(bucket.allowed_mime_types.includes('image/webp'));
});
test('managed products create and update multiple variants atomically',async()=>{
 await role('admin');await saveManaged();
 const timestamp=await scalar('select updated_at::text from products where id=$1',[ids.created]);
 await saveManaged({...managedInput,name:'Updated'},[{...managedVariant,stock:'12',expected_stock:10},{...managedVariant,id:'70000000-0000-4000-8000-000000000002',stock:'4'}],false,timestamp);
 assert.equal(await scalar('select name from products where id=$1',[ids.created]),'Updated');
 assert.equal(await scalar('select sum(stock)::int from product_variants where product_id=$1',[ids.created]),16);
});
test('editing cannot overwrite stock consumed by an order',async()=>{
 await role('admin');await saveManaged();
 const timestamp=await scalar('select updated_at::text from products where id=$1',[ids.created]);
 await role();await place({items:[{variant_id:managedVariant.id,qty:1}]});await role('admin');
 await assert.rejects(saveManaged({...managedInput,name:'Should roll back'},[{...managedVariant,stock:'20',expected_stock:10}],false,timestamp),/Stock changed/);
 assert.equal(await scalar('select name from products where id=$1',[ids.created]),'Managed product');
 assert.equal(await scalar('select stock from product_variants where id=$1',[managedVariant.id]),9);
});
test('stale product details and foreign variants are rejected',async()=>{
 await role('admin');await saveManaged();
 await assert.rejects(saveManaged(managedInput,[managedVariant],false,'2000-01-01'),/product changed/);
 const timestamp=await scalar('select updated_at::text from products where id=$1',[ids.created]);
 await assert.rejects(saveManaged(managedInput,[{...managedVariant,id:ids.variant,expected_stock:30}],false,timestamp),/another product/);
});
test('customers cannot save products or manage coupons and brands',async()=>{
 await assert.rejects(saveManaged(),/Admins only/);
 await assert.rejects(db.query("insert into coupons values('BAD',10,true)"),/row-level security/);
 await assert.rejects(db.query("insert into brands(name,slug) values('Bad','bad')"),/row-level security/);
});
test('customers can only read their own order items and profile',async()=>{
 const id=await place();await role('other');
 assert.equal(await scalar('select count(*)::int from orders where id=$1',[id]),0);
 assert.equal(await scalar('select count(*)::int from order_items where order_id=$1',[id]),0);
 assert.equal(await scalar('select count(*)::int from profiles where id=$1',[ids.customer]),0);
});

test('one-step fresh setup is atomic and creates starter categories',async()=>{
 const fresh=new PGlite();
 try{
  await fresh.exec(bootstrap);
  await fresh.exec(await readFile(new URL('../supabase/setup.sql',import.meta.url),'utf8'));
  assert.equal((await fresh.query('select count(*)::int as n from categories')).rows[0].n,6);
  assert.equal((await fresh.query('select backend_version() as v')).rows[0].v,'20261002');
  assert.equal((await fresh.query('select count(*)::int as n from products')).rows[0].n,0);
 }finally{await fresh.close();}
});

test('saved items are private, persist per account, and reject stale writes',async()=>{
 await db.exec('reset role; truncate customer_saved_items');await role();
 const save = (kind,payload,version) => scalar('select save_customer_items($1,$2::jsonb,$3)',[kind,JSON.stringify(payload),version]);
 assert.equal(await save('wishlist',[ids.product],0),1);
 await assert.rejects(save('wishlist',[],0),/changed/);
 await role('other');assert.equal(await scalar('select count(*) from customer_saved_items'),0);
 await save('wishlist',[],0);
 await role('customer');assert.deepEqual(await scalar("select payload from customer_saved_items where kind='wishlist'"),[ids.product]);
 await assert.rejects(db.exec('delete from customer_saved_items'),/permission denied/);
 await assert.rejects(save('cart',[{variant_id:ids.variant,name:'Item',price:10,qty:21}],0),/Invalid cart/);
 await role('', 'anon');await assert.rejects(db.exec('select * from customer_saved_items'),/permission denied/);
 await assert.rejects(save('wishlist',[],0),/permission denied/);
});
