import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key=(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
if(!url||!key){console.error('Supabase is not connected. Add the Project URL and publishable key to .env.local, then run this command again.');process.exit(1);}
if(key.startsWith('sb_secret_')){console.error('Use a publishable key, not a secret key.');process.exit(1);}
try{
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const version=await client.rpc('backend_version');
 if(version.error)throw new Error('Backend schema is missing or unreachable: '+version.error.message);
 if(version.data!=='20261002')throw new Error('Admin upgrade pending. Run supabase/migrations/20261002_admin_features.sql once in Supabase SQL Editor, then rerun this check. Do not rerun setup.sql.');
 for(const table of ['categories','brands','products','product_variants','product_images','blog_posts']){
  const {error}=await client.from(table).select('id').limit(0);if(error)throw new Error(table+': '+error.message);
 }
 for(const table of ['product_reviews','related_products']){
  const {error}=await client.from(table).select('*').limit(0);if(error)throw new Error(table+': '+error.message);
 }
 const media=await client.storage.from('media').list('products',{limit:1});
 if(media.error)throw new Error('Media storage: '+media.error.message);
 console.log('PASS: Supabase connection, backend version, public catalog permissions and media bucket.');
 console.log('Manage products, users, reviews, discounts and analytics at /admin with your admin account.');
 console.log('Authenticated order placement and image upload still require a signed-in account test.');
}catch(error){console.error(error.message);process.exitCode=1;}
