export const dynamic="force-dynamic";
import Link from "next/link";import {sb,isSupabaseConfigured} from "@/lib/supabase";export const metadata={title:"Blog"};
export default async function B(){if(!isSupabaseConfigured)return <main><h1>Blog</h1><p>Articles will appear once the store is connected.</p></main>;const {data,error}=await sb.from("blog_posts").select("title,slug,excerpt").eq("published",true).order("created_at",{ascending:false});
if(error)throw error;
return(<main><h1>Blog</h1>{(data||[]).map(p=><p key={p.slug}><Link href={`/blog/${p.slug}`}><b>{p.title}</b></Link><br/>{p.excerpt}</p>)}</main>)}
