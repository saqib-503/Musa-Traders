// Read-only checks against the configured storefront. No signup, orders or uploads.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
const base=process.env.PREVIEW_URL||'http://localhost:3000';
let browser,page;const errors=[];
before(async()=>{
 const executablePath=[process.env.BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium'].find(p=>p&&existsSync(p));
 browser=await chromium.launch({executablePath,headless:true});page=await browser.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/hydration|hydrated|did not match/i.test(m.text()))errors.push(m.text());});
});
after(async()=>{await browser?.close();});
test('live storefront loads seeded categories without demo fallback',async()=>{
 const response=await page.goto(base);assert.equal(response.status(),200);
 await page.getByRole('heading',{name:'Shop by category',exact:true}).waitFor();
 assert.equal(await page.locator('.category-tile').count(),6);
 assert.equal(await page.locator('.preview-label').count(),0);
 await page.locator('.category-tile').filter({hasText:'Clothing'}).click();
 await page.getByRole('heading',{name:'Clothing',exact:true}).waitFor();
});
test('real authentication and admin screens render with appropriate access controls',async()=>{
 await page.goto(base+'/login');await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
 await page.getByRole('link',{name:'Create an account',exact:true}).click();await page.getByRole('button',{name:'Create account',exact:true}).waitFor();
 await page.goto(base+'/account');await page.getByRole('link',{name:'Sign in or create an account',exact:true}).waitFor();
 await page.goto(base+'/admin');await page.getByText(/Admins only\.|Admin upgrade required:/).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Store administration',exact:true}).count(),0);
 await page.goto(base+'/reset-password');await page.getByRole('button',{name:'Send reset link',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
});
