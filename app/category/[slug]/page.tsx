import {demoProducts,demoCategories} from "@/lib/demo";
import ProductGrid from "@/components/ProductGrid";
import {isSupabaseConfigured,sb,CARD_COLS,Product,SITE} from "@/lib/supabase";import {notFound} from "next/navigation";
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){const {slug}=await params;if(!isSupabaseConfigured)return{title:demoCategories.find(c=>c.slug===slug)?.name};const {data:c,error}=await sb.from("categories").select("name,seo_title,seo_description").eq("slug",slug).eq("status","active").maybeSingle();
if(error)throw error;
return{title:c?.seo_title||c?.name,description:c?.seo_description||undefined,alternates:{canonical:`${SITE}/category/${slug}`}}}
export default async function Cat({params}:{params:Promise<{slug:string}>}){const {slug}=await params;if(!isSupabaseConfigured){const category=demoCategories.find(c=>c.slug===slug);if(!category)notFound();return <main><ProductGrid products={demoProducts.filter(p=>p.category===slug)} title={category.name}/></main>;}
const {data:c,error}=await sb.from("categories").select("id,name,description").eq("slug",slug).eq("status","active").maybeSingle();if(error)throw error;if(!c)notFound();
const {data:kids,error:kidsError}=await sb.from("categories").select("id").eq("parent_id",c.id);if(kidsError)throw kidsError;const ids=[c.id,...(kids||[]).map(k=>k.id)];
const {data:links,error:linksError}=await sb.from("product_categories").select("product_id").in("category_id",ids);
if(linksError)throw linksError;
const {data,error:productsError}=await sb.from("products").select(CARD_COLS).eq("status","active").in("id",(links||[]).map(l=>l.product_id));
if(productsError)throw productsError;
return(<main><h1>{c.name}</h1><p>{c.description}</p><ProductGrid products={(data||[]) as unknown as Product[]} title={`${c.name} products`}/></main>)}
