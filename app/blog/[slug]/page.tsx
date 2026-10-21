import {jsonLd} from "@/lib/utils";
import {isSupabaseConfigured,sb,SITE} from "@/lib/supabase";import {notFound} from "next/navigation";
const get=async(slug:string)=>{
 if(!isSupabaseConfigured)return null;
 const {data,error}=await sb.from("blog_posts").select("*").eq("slug",slug).eq("published",true).maybeSingle();
 if(error)throw error; return data;
};
export async function generateMetadata({params}:{params:Promise<{slug:string}>}){const p=await get((await params).slug);return p?{title:p.title,description:p.excerpt}:{}}
export default async function Post({params}:{params:Promise<{slug:string}>}){const p=await get((await params).slug);if(!p)notFound();
const ld={"@context":"https://schema.org","@type":"Article",headline:p.title,datePublished:p.created_at,mainEntityOfPage:`${SITE}/blog/${p.slug}`};
return(<main style={{maxWidth:720}}><script type="application/ld+json" dangerouslySetInnerHTML={{__html:jsonLd(ld)}}/><h1>{p.title}</h1><div style={{whiteSpace:"pre-line",lineHeight:1.7}}>{p.body}</div></main>)}
