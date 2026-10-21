import {createClient} from "@supabase/supabase-js";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const isSupabaseConfigured=Boolean(url?.trim() && key?.trim());
function configuredClient(){
 return createClient(url!,key!,{auth:{persistSession:typeof window!=="undefined",autoRefreshToken:typeof window!=="undefined",detectSessionInUrl:typeof window!=="undefined"}});
}
// Missing settings allow the storefront preview to render. Accidental backend calls
// fail locally; no fake credentials or network requests are used in preview mode.
export const sb=isSupabaseConfigured?configuredClient():new Proxy({} as ReturnType<typeof configuredClient>,{
 get(){throw new Error("Connect Supabase to enable this feature.");}
});
export const money=(n:number)=>"Rs. "+Number(n).toLocaleString("en-PK");
export const SITE=process.env.NEXT_PUBLIC_SITE_URL||"http://localhost:3000";
export type Product={product_reviews?:{rating:number;approved:boolean}[];featured?:boolean;new_arrival?:boolean;best_seller?:boolean;tags?:string[];art?:string;tone?:string;badge?:string;category?:string;id:string;name:string;slug:string;short_description:string|null;description:string|null;regular_price:number;sale_price:number|null;brands:{name:string}|null;product_images:{url:string;alt:string|null;sort_order:number}[];product_variants:{id:string;color:string|null;configuration?:string|null;price_override:number|null;stock:number}[];model_number?:string|null;recommended_age?:string|null;max_load_kg?:number|null;charging_time_hours?:number|null;warranty_text?:string|null;safety_information?:string|null;box_contents?:string|null;material?:string|null;product_dimensions_cm?:string|null;technical_specs?:Record<string,string>|null;product_addons?:{id?:string;name:string;description:string|null;price_adjustment:number;active:boolean;sort_order:number}[]};
// Keep catalog cards small. Full review content is fetched only on a product page.
export const PCOLS="id,name,slug,featured,new_arrival,best_seller,short_description,description,regular_price,sale_price,seo_title,seo_description,model_number,recommended_age,max_load_kg,charging_time_hours,warranty_text,safety_information,box_contents,material,product_dimensions_cm,technical_specs,brands(name),product_images(url,alt,sort_order),product_variants(id,color,configuration,price_override,stock),product_addons(id,name,description,price_adjustment,active,sort_order)";
export const CARD_COLS="id,name,slug,featured,new_arrival,best_seller,regular_price,sale_price,brands(name),product_images(url,alt,sort_order),product_variants(id,color,configuration,price_override,stock)";
export {cart} from "./storage";
