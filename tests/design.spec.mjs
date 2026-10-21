import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const base = process.env.PREVIEW_URL || 'http://localhost:3000';
let browser, page;
const errors=[];
before(async()=>{
 const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 browser=await chromium.launch({executablePath,headless:true});page=await browser.newPage({viewport:{width:1920,height:1080}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/hydrat|did not match/i.test(m.text()))errors.push(m.text());});
 await mkdir('tmp/design',{recursive:true});
});
after(async()=>{await browser?.close();});
test('desktop reference layout renders 12 cards and captures the complete page',async()=>{
 await page.goto(base);await page.locator('.product-card').first().waitFor();
 assert.equal(await page.locator('.product-card').count(),12);
 assert.equal(await page.locator('.category-tile').count(),6);
 await page.screenshot({path:'tmp/design/desktop.png',fullPage:true,caret:'initial'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
});
test('sorting, wishlist and cart interactions work with the preview collection',async()=>{
 await page.getByLabel('Sort products').selectOption('low');
 assert.equal(await page.locator('.product-card .product-name').first().textContent(),'Silicone bib with pocket');
 const first=page.locator('.product-card').first();await first.getByRole('button',{name:/Save .* to wishlist/}).click();
 await page.getByRole('link',{name:'Wishlist, 1 items',exact:true}).waitFor();
 await first.getByRole('button',{name:'Add to cart',exact:true}).click();
 await page.getByRole('link',{name:'Cart, 1 items',exact:true}).waitFor();
 await page.getByRole('link',{name:'Wishlist, 1 items',exact:true}).click();
 await page.getByRole('heading',{name:'Your wishlist',exact:true}).waitFor();assert.equal(await page.locator('.product-card').count(),1);
 await page.getByRole('link',{name:'Cart, 1 items',exact:true}).click();await page.getByRole('heading',{name:'Cart',exact:true}).waitFor();
 await page.getByText(/Silicone bib with pocket/).waitFor();
});
test('category pages, product details and brand search work',async()=>{
 await page.goto(base+'/category/clothing');await page.getByRole('heading',{name:'Clothing',exact:true}).waitFor();
 assert.equal(await page.locator('.product-card').count(),2);
 await page.getByRole('link',{name:'Organic cotton romper',exact:true}).click();await page.getByRole('heading',{name:'Organic cotton romper',exact:true}).waitFor();
 await page.getByRole('button',{name:'Compare',exact:true}).click();
 await page.goto(base+'/compare');await page.getByText('Organic cotton romper',{exact:true}).waitFor();
 await page.getByLabel('Search products or brands').fill('PureSip');await page.getByLabel('Search products or brands').press('Enter');
 await page.getByRole('heading',{name:/Results for/}).waitFor();assert.equal(await page.locator('.product-card').count(),2);
});
test('mobile layout has no horizontal overflow and retains all products',async()=>{
 await page.setViewportSize({width:390,height:844});await page.goto(base);await page.locator('.product-card').first().waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 assert.equal(await page.locator('.product-card').count(),12);
 await page.screenshot({path:'tmp/design/mobile.png',fullPage:true,caret:'initial'});
 assert.deepEqual(errors,[]);
});
