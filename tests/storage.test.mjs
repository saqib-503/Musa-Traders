import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function load(path) {
  const source = (await readFile(new URL(path,import.meta.url),'utf8')).replaceAll('await import("./supabase")', 'globalThis.savedItemsBackend');
  const {outputText} = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const {cart,compare,checkoutRequest,loadAccountStorage,clearAccountStorage,favourites}=await load('../lib/storage.ts');
const {jsonLd}=await load('../lib/utils.ts');
const id='10000000-0000-4000-8000-000000000001';
let values;
let user, rows, writes, failSave;
beforeEach(()=>{clearAccountStorage(); user={id}; rows=[];writes=[];failSave=false;
 globalThis.savedItemsBackend={isSupabaseConfigured:true,sb:{auth:{getUser:async()=>({data:{user},error:null})},from:()=>({select:()=>({eq:async()=>({data:rows,error:null})})}),rpc:async(name,args)=>{writes.push(args);return {data:args.p_expected_version+1,error:failSave?{message:'offline'}:null};}}};
 values=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}});});
test('malformed or wrong-shaped storage does not crash cart or compare',()=>{
  for(const raw of ['{','null','{}','1','"text"','[null,{},1]']) {
    values.set('cart',raw);values.set('compare:v2',raw);
    assert.deepEqual(cart.get(),[]);assert.deepEqual(compare.get(),[]);
  }
});
test('guest browser data is ignored and cannot be saved',async()=>{
  user=null;values.set('cart',JSON.stringify([{variant_id:id,name:'Item',price:10,qty:1}]));
  assert.equal(await loadAccountStorage(),false);assert.deepEqual(cart.get(),[]);
  await assert.rejects(cart.set([]),/sign in/);assert.equal(writes.length,0);
});
test('account loads cart and wishlist, validates quantities and persists changes',async()=>{
 rows=[{kind:'cart',version:2,payload:[{variant_id:id,name:'Item',price:10,qty:15},{variant_id:id,name:'Item',price:10,qty:15}]},{kind:'wishlist',version:1,payload:[id]}];
 await loadAccountStorage();assert.equal(cart.get()[0].qty,20);assert.deepEqual(favourites.get(),[id]);
 await cart.set([]);assert.equal(writes[0].p_expected_version,2);assert.deepEqual(cart.get(),[]);
 await favourites.toggle(id);assert.deepEqual(favourites.get(),[]);
});
test('switching accounts and signing out clear the previous customer data',async()=>{
 rows=[{kind:'wishlist',version:1,payload:[id]}];await loadAccountStorage();assert.equal(favourites.get().length,1);
 user={id:'10000000-0000-4000-8000-000000000002'};rows=[];await loadAccountStorage();assert.deepEqual(favourites.get(),[]);
 clearAccountStorage();assert.deepEqual(cart.get(),[]);
});
test('failed saves preserve the confirmed saved items',async()=>{
 rows=[{kind:'wishlist',version:1,payload:[id]}];await loadAccountStorage();failSave=true;
 await assert.rejects(favourites.toggle(id),/could not be saved/);assert.deepEqual(favourites.get(),[id]);
});
test('comparison uses unique IDs, keeps four, and ignores legacy names',()=>{
  values.set('compare',JSON.stringify(['Old item']));assert.deepEqual(compare.get(),[]);
  for(let index=1;index<=5;index++)compare.add(`10000000-0000-4000-8000-00000000000${index}`);
  const saved=compare.get();assert.equal(saved.length,4);compare.add(saved[0]);assert.equal(compare.get().length,4);
  assert.throws(()=>compare.add('Product name'));
});
test('checkout retries preserve a key while details and user remain unchanged',()=>{
  const first=checkoutRequest('user',{items:[id]});
  assert.equal(checkoutRequest('user',{items:[id]}),first);
  assert.notEqual(checkoutRequest('other',{items:[id]}),first);
  assert.notEqual(checkoutRequest('user',{items:[]}),first);
});
test('blocked storage prevents sending an unpersisted checkout request',()=>{
  localStorage.setItem=()=>{throw new Error('blocked');};assert.throws(()=>checkoutRequest('user',{}),/blocked/);
});
test('structured data cannot break out of its script element',()=>{
  const payload={name:'</script><script>alert(1)</script>',text:'<>&'};
  const encoded=jsonLd(payload);assert.ok(!encoded.includes('<'));assert.deepEqual(JSON.parse(encoded),payload);
});
