export const dynamic="force-dynamic";
import {isSupabaseConfigured,sb,SITE} from "@/lib/supabase";import type {MetadataRoute} from "next";
export default async function sitemap():Promise<MetadataRoute.Sitemap>{if(!isSupabaseConfigured)return[{url:SITE},{url:`${SITE}/blog`}];const [p,c,b]=await Promise.all([sb.from("products").select("slug").eq("status","active"),sb.from("categories").select("slug").eq("status","active"),sb.from("blog_posts").select("slug").eq("published",true)]);
for(const result of [p,c,b])if(result.error)throw result.error;
return[{url:SITE},{url:`${SITE}/blog`},...(p.data||[]).map(x=>({url:`${SITE}/product/${x.slug}`})),...(c.data||[]).map(x=>({url:`${SITE}/category/${x.slug}`})),...(b.data||[]).map(x=>({url:`${SITE}/blog/${x.slug}`}))]}
