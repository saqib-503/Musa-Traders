// Browser tests use mocked Supabase responses and never contact a live backend.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const base = 'http://127.0.0.1:3100';
const backend = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
const userId = '10000000-0000-4000-8000-000000000001';
const variantId = '30000000-0000-4000-8000-000000000001';
const orderId = '50000000-0000-4000-8000-000000000001';
const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const expiry = Math.floor(Date.now()/1000)+3600;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const token = `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:userId,role:'authenticated',exp:expiry})}.test-signature`;
const authKey = `sb-${new URL(backend).hostname.split('.')[0]}-auth-token`;
let server, browser, context, page, handler, serverOutput = '';
const pageErrors = [];
let savedRows;

before(async () => {
  const executablePath = [process.env.BROWSER_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(value => value && existsSync(value));
  if (!executablePath) throw new Error('Set BROWSER_EXECUTABLE to a local Chrome or Chromium executable.');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','-p','3100'], {
    windowsHide:true, env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:backend,NEXT_PUBLIC_SUPABASE_ANON_KEY:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'review-placeholder-not-a-real-key'}, stdio:['ignore','pipe','pipe'],
  });
  server.stdout.on('data', chunk => serverOutput += chunk.toString());
  server.stderr.on('data', chunk => serverOutput += chunk.toString());
  let ready = false;
  for (let attempt=0;attempt<60;attempt++) {
    if (server.exitCode !== null) throw new Error(serverOutput);
    try { if ((await fetch(`${base}/login`)).ok) { ready=true;break; } } catch {}
    await delay(500);
  }
  if (!ready) throw new Error(`Server did not start: ${serverOutput}`);
  browser = await chromium.launch({executablePath,headless:true});
});
after(async () => { await browser?.close(); server?.kill(); });
beforeEach(async () => {
  savedRows=[{kind:"cart",version:1,payload:[{variant_id:variantId,name:"Test item",price:800,qty:2}]}];
  context = await browser.newContext(); pageErrors.length=0; handler=null;
  await context.addInitScript(({authKey,user,token,expiry,variantId}) => {
    if(!sessionStorage.getItem('fixture-ready')) {
      localStorage.setItem(authKey,JSON.stringify({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,expires_at:expiry,user}));
      localStorage.setItem('cart',JSON.stringify([{variant_id:variantId,name:'Test item',price:800,qty:2}]));
      sessionStorage.setItem('fixture-ready','1');
    }
  },{authKey,user,token,expiry,variantId});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (handler && await handler(route,url)) return;
    const respond = body => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/rest/v1/customer_saved_items') return respond(savedRows);
    if(url.pathname==='/rest/v1/rpc/save_customer_items') {
      const args=route.request().postDataJSON();const row=savedRows.find(r=>r.kind===args.p_kind);
      const version=(row?.version||0)+1;savedRows=savedRows.filter(r=>r.kind!==args.p_kind);savedRows.push({kind:args.p_kind,payload:args.p_payload,version});return respond(version);
    }
    if(url.pathname==='/auth/v1/user') return respond(user);
    if(url.pathname==='/rest/v1/rpc/is_admin') return respond(true);
    if(url.pathname==='/rest/v1/rpc/backend_version') return respond('20261002');
    if(url.pathname==='/rest/v1/notifications') return respond([]);
    if(url.pathname==='/rest/v1/rpc/admin_analytics') return respond({users:3,products:2,active_products:1,featured:1,new_arrivals:0,orders:2,delivered_revenue:1850,open_value:0,average_order:1850,statuses:[],daily:[],top_products:[],low_stock:[]});
    if(url.pathname==='/rest/v1/products' || url.pathname==='/rest/v1/categories' || url.pathname==='/rest/v1/brands') return respond([]);
    if(url.pathname==='/rest/v1/orders') return respond({total:1850});
    // Prevent every unhandled external request, including accidental live writes.
    return route.abort();
  });
  page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
});
afterEach(async () => { await context?.close(); assert.deepEqual(pageErrors,[],'No browser runtime errors'); });
async function delivery() {
  await page.getByLabel('Name',{exact:true}).fill('Buyer');
  await page.getByLabel('Phone',{exact:true}).fill('03001234567');
  await page.getByLabel('Address',{exact:true}).fill('Street 1');
  await page.getByLabel('City',{exact:true}).fill('Lahore');
}

test('malformed saved cart and comparison show safe empty states',async()=>{
  savedRows=[{kind:'cart',version:1,payload:{}}];
  await page.goto(`${base}/cart`);
  await page.evaluate(()=>{localStorage.setItem('cart','{}');localStorage.setItem('compare:v2','{');});
  await page.reload();await page.getByText('Your cart is empty.').waitFor();
  assert.equal(await page.getByRole('link',{name:'Checkout',exact:true}).count(),0);
  await page.goto(`${base}/compare`);await page.getByText('Add products with the Compare button on a product page.').waitFor();
});

test('existing saved cart loads the cover image, links to the product and removes the item',async()=>{
 const imageUrl=backend+'/storage/v1/object/public/media/products/cart-cover.png';
 handler=async(route,url)=>{
  if(url.pathname==='/rest/v1/product_variants'){
   assert.equal(url.searchParams.get('id'),`in.(${variantId})`);
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:variantId,products:{slug:'test-item',product_images:[{url:backend+'/other.png',sort_order:2},{url:imageUrl,sort_order:0}]}}])});return true;
  }
  if(url.href===imageUrl){await route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64')});return true;}return false;
 };
 await page.goto(`${base}/cart`);const image=page.getByRole('img',{name:'Test item',exact:true});await image.waitFor();
 assert.equal(await image.getAttribute('src'),imageUrl);assert.equal(await page.getByRole('link',{name:'View Test item',exact:true}).getAttribute('href'),'/product/test-item');
 await page.getByText('Subtotal Rs. 1,600',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'Remove',exact:true}).click();await page.getByText('Your cart is empty.',{exact:true}).waitFor();assert.equal(await image.count(),0);
});

test('cart remains usable when images fail and can retry without changing quantities',async()=>{
 let fail=true;
 handler=async(route,url)=>{
  if(url.pathname!=='/rest/v1/product_variants')return false;
  await route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?{message:'Unavailable'}:[{id:variantId,products:{slug:'test-item',product_images:[]}}])});return true;
 };
 await page.goto(`${base}/cart`);await page.getByRole('button',{name:'Retry images',exact:true}).waitFor();await page.getByText('Subtotal Rs. 1,600',{exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Checkout',exact:true}).count(),1);
 fail=false;await page.getByRole('button',{name:'Retry images',exact:true}).click();await page.getByRole('link',{name:'View Test item',exact:true}).waitFor();await page.getByText('No image',{exact:true}).waitFor();
 assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('cart')))[0].qty,2);
});
test('checkout validates required fields and blocks duplicate clicks',async()=>{
  let calls=0;let payload;
  handler=async(route,url)=>{
    if(url.pathname!=='/rest/v1/rpc/place_order')return false;
    calls++;payload=route.request().postDataJSON();await delay(150);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(orderId)});return true;
  };
  await page.goto(`${base}/checkout`);
  await page.getByRole('button',{name:'Place order (cash on delivery)',exact:true}).click();assert.equal(calls,0);
  await delivery();
  await page.getByRole('button',{name:'Place order (cash on delivery)',exact:true}).evaluate(button=>{button.click();button.click();});
  await page.getByRole('status').filter({hasText:'Total: Rs.'}).waitFor();
  assert.equal(calls,1);assert.ok(payload.p_request_id);assert.equal(payload.items[0].qty,2);
  assert.deepEqual(savedRows.find(r=>r.kind==='cart').payload,[]);
});
test('failed checkout survives reload and retries using the original request ID',async()=>{
  const requests=[];
  handler=async(route,url)=>{
    if(url.pathname!=='/rest/v1/rpc/place_order')return false;
    requests.push(route.request().postDataJSON().p_request_id);
    await route.fulfill({status:requests.length===1?503:200,contentType:'application/json',body:JSON.stringify(requests.length===1?{message:'Temporary service failure',code:'TEST'}:orderId)});return true;
  };
  await page.goto(`${base}/checkout`);await delivery();await page.getByRole('button',{name:'Place order (cash on delivery)',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Temporary service failure'}).waitFor();
  await page.reload();await delivery();await page.getByRole('button',{name:'Place order (cash on delivery)',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Total: Rs.'}).waitFor();
  assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);
});
test('accepted order remains successful when its total cannot be fetched',async()=>{
  handler=async(route,url)=>{
    if(url.pathname==='/rest/v1/rpc/place_order') {await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(orderId)});return true;}
    if(url.pathname==='/rest/v1/orders'){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Unavailable'})});return true;}
    return false;
  };
  await page.goto(`${base}/checkout`);await delivery();await page.getByRole('button',{name:'Place order (cash on delivery)',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Total is temporarily unavailable; please do not place it again.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Place order (cash on delivery)',exact:true}).isDisabled(),true);
});
test('admin product errors remain visible and retry uses one product ID',async()=>{
  const requests=[];
  handler=async(route,url)=>{
    if(url.pathname!=='/rest/v1/rpc/save_product')return false;
    requests.push(route.request().postDataJSON().p_id);
    await route.fulfill({status:requests.length===1?400:200,contentType:'application/json',body:JSON.stringify(requests.length===1?{message:'Invalid category',code:'TEST'}:requests.at(-1))});return true;
  };
  await page.goto(`${base}/admin/products`);await page.getByRole('heading',{name:'Products',exact:true}).waitFor();
  await page.getByLabel('Name',{exact:true}).fill('New item');await page.getByLabel('Regular price',{exact:true}).fill('500');
  await page.getByRole('button',{name:'Add product',exact:true}).click();await page.getByRole('status').filter({hasText:'Invalid category'}).waitFor();
  await page.getByRole('button',{name:'Add product',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved'}).waitFor();
  assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'');
});
test('access-check failures show a recoverable error instead of false denial',async()=>{
  handler=async(route,url)=>{
    if(url.pathname!=='/rest/v1/rpc/is_admin')return false;
    await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Access service unavailable'})});return true;
  };
  await page.goto(`${base}/admin`);await page.getByRole('alert').filter({hasText:'Access service unavailable'}).waitFor();
  handler=null;await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('heading',{name:'Store administration',exact:true}).waitFor();
});

test('customer account displays profile and detailed order history',async()=>{
  handler=async(route,url)=>{
    if(url.pathname==='/rest/v1/rpc/is_admin') {await route.fulfill({status:200,contentType:'application/json',body:'false'});return true;}
    if(url.pathname==='/rest/v1/profiles') {await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:userId,full_name:'Buyer',phone:'03001234567',role:'customer'})});return true;}
    if(url.pathname==='/rest/v1/orders') {
      assert.equal(url.searchParams.get('user_id'),'eq.'+userId);
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:orderId,name:'Buyer',phone:'03001234567',address:'Street 1',city:'Lahore',status:'pending',total:1850,subtotal:1600,discount:0,shipping:250,created_at:new Date().toISOString(),coupon_code:null,order_items:[{id:'line-1',name:'Test item',qty:2,unit_price:800}]}])});return true;
    }
    return false;
  };
  await page.goto(`${base}/account`);await page.getByRole('heading',{name:'Your orders',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Full name',{exact:true}).inputValue(),'Buyer');
  await page.locator('.order-details summary').click();await page.getByRole('cell',{name:'Test item',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open admin panel',exact:true}).count(),0);
});

test('admin account opens management dashboard and retains an explicit personal profile link',async()=>{
 handler=async(route,url)=>{
  if(url.pathname==='/rest/v1/profiles'){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:userId,full_name:'Owner',phone:'',role:'admin'})});return true;}
  if(url.pathname==='/rest/v1/orders'){await route.fulfill({status:200,contentType:'application/json',body:'[]'});return true;}return false;
 };
 await page.goto(`${base}/account`);await page.waitForURL(`${base}/admin`);
 await page.getByRole('heading',{name:'Store administration',exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Your orders',exact:true}).count(),0);
 await page.getByRole('link',{name:'Add product',exact:true}).click();await page.getByRole('button',{name:'Add product',exact:true}).waitFor();
 await page.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('link',{name:'Manage orders',exact:true}).click();await page.getByRole('heading',{name:'Orders',exact:true}).waitFor();
 await page.getByRole('link',{name:'My account',exact:true}).click();await page.getByRole('heading',{name:'Your orders',exact:true}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('view'),'profile');assert.equal(await page.getByLabel('Full name',{exact:true}).inputValue(),'Owner');
 await page.getByRole('link',{name:'Open admin panel',exact:true}).click();await page.getByRole('heading',{name:'Store administration',exact:true}).waitFor();
});

for(const admin of [true,false])test(`${admin?'admin':'customer'} sign-in lands on the appropriate page`,async()=>{
 handler=async(route,url)=>{
  const respond=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  if(url.pathname==='/auth/v1/token'){assert.equal(url.searchParams.get('grant_type'),'password');await respond({access_token:token,refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,expires_at:expiry,user});return true;}
  if(url.pathname==='/rest/v1/rpc/is_admin'){await respond(admin);return true;}
  if(url.pathname==='/rest/v1/profiles'){await respond({id:userId,full_name:'Buyer',phone:'',role:admin?'admin':'customer'});return true;}
  if(url.pathname==='/rest/v1/orders'){await respond([]);return true;}return false;
 };
 await page.goto(`${base}/login`);await page.getByLabel('Email',{exact:true}).fill('test@example.invalid');await page.getByLabel('Password',{exact:true}).fill('mock-password-only');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await page.waitForURL(`${base}/${admin?'admin':'account'}`);await page.getByRole('heading',{name:admin?'Store administration':'Your orders',exact:true}).waitFor();
 assert.equal(await page.locator('.header-account-link').getAttribute('href'),admin?'/admin':'/account');
 assert.match((await page.locator('.header-account-link').textContent())||'',/Buyer/);
});

test('separate signup validates confirmation and shows email verification without signing in',async()=>{
 let calls=0,payload;
 handler=async(route,url)=>{
  if(url.pathname!=='/auth/v1/signup')return false;
  calls++;payload=route.request().postDataJSON();await delay(150);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...user,identities:[]})});return true;
 };
 await page.goto(`${base}/login`);assert.equal(await page.getByLabel('Full name',{exact:true}).count(),0);
 await page.getByRole('link',{name:'Create an account',exact:true}).click();await page.waitForURL(`${base}/signup`);
 await page.getByLabel('Full name',{exact:true}).fill('New Parent');await page.getByLabel('Email',{exact:true}).fill('parent@example.invalid');
 await page.getByLabel('Password',{exact:true}).fill('test-password');await page.getByLabel('Confirm password',{exact:true}).fill('different-password');
 await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByRole('alert').filter({hasText:'Passwords do not match.'}).waitFor();assert.equal(calls,0);
 await page.getByRole('button',{name:'Show password',exact:true}).click();assert.equal(await page.getByLabel('Password',{exact:true}).getAttribute('type'),'text');
 await page.getByRole('button',{name:'Hide password',exact:true}).click();await page.getByLabel('Confirm password',{exact:true}).fill('test-password');
 await page.getByRole('button',{name:'Create account',exact:true}).evaluate(button=>{button.click();button.click();});
 await page.getByRole('heading',{name:'Check your inbox',exact:true}).waitFor();assert.equal(calls,1);assert.equal(payload.data.full_name,'New Parent');assert.equal(payload.email,'parent@example.invalid');
 await page.getByRole('link',{name:/Back to login/}).click();await page.waitForURL(`${base}/login`);await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'');
});

test('login failures remain visible and the form can be retried',async()=>{
 handler=async(route,url)=>{if(url.pathname!=='/auth/v1/token')return false;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'invalid_credentials',message:'Invalid login credentials'})});return true;};
 await page.goto(`${base}/login`);await page.getByLabel('Email',{exact:true}).fill('test@example.invalid');await page.getByLabel('Password',{exact:true}).fill('wrong-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('alert').filter({hasText:'Invalid login credentials'}).waitFor();assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).isEnabled(),true);assert.equal(new URL(page.url()).pathname,'/login');
});
test('category editor persists a new category using the backend',async()=>{
  const rows=[];
  handler=async(route,url)=>{
    if(url.pathname!=='/rest/v1/categories')return false;
    if(route.request().method()==='POST') {
      const payload=route.request().postDataJSON();assert.equal(payload.name,'New category');assert.equal(payload.slug,'new-category');rows.push({id:orderId,...payload});
      await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(rows[0])});
    }else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)});
    return true;
  };
  await page.goto(`${base}/admin/categories`);await page.getByRole('heading',{name:'Categories',exact:true}).waitFor();
  await page.getByLabel('Name',{exact:true}).fill('New category');await page.getByRole('button',{name:'Save category',exact:true}).click();
  await page.getByRole('cell',{name:'New category',exact:true}).waitFor();assert.equal(rows.length,1);
});

test('category image upload retries safely, persists its URL and can be removed while editing',async()=>{
 const rows=[];let uploads=0,saves=0;const payloads=[];
 handler=async(route,url)=>{
  const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(url.pathname.startsWith('/storage/v1/object/media/categories/')){
   uploads++;await respond(uploads===1?{message:'Upload temporarily unavailable'}:{Key:'media/category.png'},uploads===1?503:200);return true;
  }
  if(url.pathname!=='/rest/v1/categories')return false;
  if(route.request().method()==='POST'){
   saves++;const payload=route.request().postDataJSON();payloads.push(payload);
   if(saves===1)await respond({message:'Category save temporarily unavailable'},503);
   else {rows.push({id:orderId,...payload});await respond(rows[0],201);}
  }else if(route.request().method()==='PATCH'){
   const payload=route.request().postDataJSON();payloads.push(payload);Object.assign(rows[0],payload);await respond(rows[0]);
  }else await respond(rows);return true;
 };
 await page.goto(`${base}/admin/categories`);await page.getByLabel('Name',{exact:true}).fill('Baby');
 assert.equal(await page.getByLabel('Image URL (optional)',{exact:true}).count(),0);
 const picker=page.getByLabel('Category image (optional)',{exact:true});
 await picker.setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await page.getByRole('status').filter({hasText:'Choose a JPG'}).waitFor();assert.equal(uploads,0);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
 await picker.setInputFiles({name:'baby.png',mimeType:'image/png',buffer:png});await page.getByAltText('Category image preview',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Save category',exact:true}).click();await page.getByRole('status').filter({hasText:'Upload temporarily unavailable'}).waitFor();assert.equal(saves,0);
 await page.getByRole('button',{name:'Save category',exact:true}).click();await page.getByRole('status').filter({hasText:'Category save temporarily unavailable'}).waitFor();
 await page.getByRole('button',{name:'Save category',exact:true}).click();await page.getByRole('cell',{name:'Baby',exact:true}).waitFor();assert.equal(uploads,2);assert.equal(saves,2);assert.equal(payloads[0].image_url,payloads[1].image_url);assert.match(rows[0].image_url,/\/storage\/v1\/object\/public\/media\/categories\/.+\.png$/);
 await page.getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await page.getByAltText('Category image preview',{exact:true}).getAttribute('src'),rows[0].image_url);
 await page.getByLabel('Description',{exact:true}).fill('Baby essentials');await page.getByRole('button',{name:'Save category',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();assert.equal(payloads.at(-1).image_url,payloads[0].image_url);assert.equal(uploads,2);
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('button',{name:'Remove image',exact:true}).click();await page.getByRole('button',{name:'Save category',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();assert.equal(payloads.at(-1).image_url,null);
});
test('product editor sends multiple variants in one atomic request',async()=>{
  let payload;
  handler=async(route,url)=>{
    if(url.pathname!=='/rest/v1/rpc/save_product')return false;
    payload=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload.p_id)});return true;
  };
  await page.goto(`${base}/admin/products`);await page.getByRole('heading',{name:'Products',exact:true}).waitFor();
  await page.getByLabel('Name',{exact:true}).fill('Two sizes');await page.getByLabel('Regular price',{exact:true}).fill('1000');
  await page.getByLabel('Variant 1 size',{exact:true}).fill('S');await page.getByRole('button',{name:'Add variant',exact:true}).click();
  await page.getByLabel('Variant 2 size',{exact:true}).fill('M');await page.getByLabel('Variant 2 stock',{exact:true}).fill('5');
  await page.getByRole('button',{name:'Add product',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved'}).waitFor();
  assert.equal(payload.p_variants.length,2);assert.equal(payload.p_variants[1].stock,'5');assert.equal(payload.p_create_only,true);
});

test('fixed discount editor submits schedule and usage limit with no percentage',async()=>{
 let saved;
 handler=async(route,url)=>{
  if(url.pathname!=='/rest/v1/coupons')return false;
  if(route.request().method()==='POST'){saved=route.request().postDataJSON();await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify(saved)});}
  else await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(saved?[saved]:[])});return true;
 };
 await page.goto(`${base}/admin/coupons`);await page.getByLabel('Code',{exact:true}).fill('EID500');
 await page.getByLabel('Discount type').selectOption('fixed');await page.getByLabel('Amount off (Rs.)',{exact:true}).fill('500');
 await page.getByLabel('Starts at',{exact:true}).fill('2026-10-10T09:00');await page.getByLabel('Expires at',{exact:true}).fill('2026-10-12T21:00');await page.getByLabel('Usage limit (optional)').fill('10');
 await page.getByRole('button',{name:'Save discount',exact:true}).click();await page.getByRole('status').filter({hasText:'Discount saved.'}).waitFor();
 assert.equal(saved.amount,500);assert.equal(saved.percent,null);assert.equal(saved.usage_limit,10);assert.ok(saved.ends_at>saved.starts_at);
});

test('user manager protects own role and changes another user through the RPC',async()=>{
 let payload;const otherId='10000000-0000-4000-8000-000000000003';
 handler=async(route,url)=>{
  if(url.pathname==='/rest/v1/rpc/admin_users'){await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({total:2,rows:[{...user,full_name:'Owner',role:'admin'},{...user,id:otherId,email:'buyer@example.invalid',full_name:'Buyer',role:'customer'}]})});return true;}
  if(url.pathname==='/rest/v1/rpc/admin_set_role'){payload=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:'null'});return true;}return false;
 };
 await page.goto(`${base}/admin/users`);await page.getByRole('cell',{name:'Owner (you)',exact:true}).waitFor();
 assert.equal(await page.getByLabel('Role for test@example.invalid',{exact:true}).isDisabled(),true);
 page.once('dialog',dialog=>dialog.accept());await page.getByLabel('Role for buyer@example.invalid',{exact:true}).selectOption('admin');
 await page.getByRole('status').filter({hasText:'Role updated.'}).waitFor();assert.deepEqual(payload,{p_user_id:otherId,p_role:'admin'});
});

test('review moderation only updates approval and removes it from the pending view',async()=>{
 let approved=false;
 handler=async(route,url)=>{
  if(url.pathname!=='/rest/v1/product_reviews')return false;
  if(route.request().method()==='PATCH'){assert.deepEqual(route.request().postDataJSON(),{approved:true});approved=true;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:orderId})});}
  else await route.fulfill({status:200,contentType:'application/json',headers:{'content-range':approved?'0-0/0':'0-0/1'},body:JSON.stringify(approved?[]:[{id:orderId,title:'Soft cotton',body:'Fits well',rating:5,approved:false,created_at:user.created_at,products:{name:'Baby suit'}}])});return true;
 };
 await page.goto(`${base}/admin/reviews`);await page.getByRole('heading',{name:'Soft cotton',exact:true}).waitFor();await page.getByRole('button',{name:'Approve',exact:true}).click();await page.getByText('No reviews in this view.',{exact:true}).waitFor();assert.equal(approved,true);
});

test('dashboard renders real response metrics and analytics filters dates',async()=>{
 await page.goto(`${base}/admin`);await page.locator('.admin-stat').filter({hasText:'Delivered order value'}).getByText('Rs. 1,850',{exact:true}).waitFor();
 let since;handler=async(route,url)=>{if(url.pathname!=='/rest/v1/rpc/admin_analytics')return false;since=route.request().postDataJSON().p_since;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Report unavailable'})});return true;};
 await page.getByLabel('Order period').selectOption('7');await page.getByRole('alert').filter({hasText:'Report unavailable'}).waitFor();assert.ok(Date.parse(since)>Date.now()-8*86400000);assert.equal(await page.locator('.admin-stat').count(),0);
});

test('multiple product uploads, SKUs and flags are saved in the atomic payload',async()=>{
 let payload;let uploads=0;
 handler=async(route,url)=>{
  if(url.pathname.startsWith('/storage/v1/object/media/')){uploads++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({Key:'media/test.png'})});return true;}
  if(url.pathname==='/rest/v1/rpc/save_product'){payload=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload.p_id)});return true;}return false;
 };
 await page.goto(`${base}/admin/products`);await page.getByLabel('Name',{exact:true}).fill('Cotton suit');await page.getByLabel('Regular price',{exact:true}).fill('1500');await page.getByLabel('SKU',{exact:true}).fill('SUIT-01');await page.getByLabel('Tags (comma separated)').fill('cotton, baby');await page.getByLabel('Featured',{exact:true}).check();await page.getByLabel('Variant 1 sku',{exact:true}).fill('SUIT-S');
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=','base64');
 await page.getByLabel('Product image',{exact:true}).setInputFiles([{name:'front.png',mimeType:'image/png',buffer:image},{name:'back.png',mimeType:'image/png',buffer:image}]);
 await page.getByRole('button',{name:'Add product',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved'}).waitFor();assert.equal(uploads,2);assert.equal(payload.p_product.images.length,2);assert.equal(payload.p_product.sku,'SUIT-01');assert.equal(payload.p_product.featured,true);assert.deepEqual(payload.p_product.tags,['cotton','baby']);assert.equal(payload.p_variants[0].sku,'SUIT-S');
});

test('old backend blocks the expanded editor until the migration is installed',async()=>{
 let migrated=false;
 handler=async(route,url)=>{if(url.pathname!=='/rest/v1/rpc/backend_version')return false;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(migrated?'20261002':'20261001')});return true;};
 await page.goto(`${base}/admin/products`);await page.getByRole('status').filter({hasText:'Admin upgrade required'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Add product',exact:true}).count(),0);
 migrated=true;await page.getByRole('button',{name:'Check again',exact:true}).click();await page.getByRole('button',{name:'Add product',exact:true}).waitFor();
});

test('guests must sign in before opening their saved cart',async()=>{
 await context.addInitScript(key=>localStorage.removeItem(key),authKey);
 handler=async(route,url)=>{if(url.pathname==='/auth/v1/user'){await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'Not signed in'})});return true;}return false;};
 await page.goto(`${base}/cart`);await page.waitForURL('**/login?next=*');
 await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();
});
