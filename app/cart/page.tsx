"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { cart, money, sb, isSupabaseConfigured } from "@/lib/supabase";
import {demoProducts} from "@/lib/demo";
import { loadAccountStorage } from "@/lib/storage";
import { errorMessage } from "@/lib/utils";
import styles from "./Cart.module.css";
type ProductMedia={slug:string;image?:string;art?:string};
function CartImage({media,name}:{media?:ProductMedia;name:string}){
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[media?.image]);
  const picture=media?.image&&!failed?<img src={media.image} alt={name} width={112} height={112} loading="lazy" onError={()=>setFailed(true)}/>:<span className={styles.placeholder}>{media?.art?<span role="img" aria-label={name}>{media.art}</span>:<><span aria-hidden="true">▧</span><small>No image</small></>}</span>;
  return media?.slug?<Link className={styles.image} href={`/product/${encodeURIComponent(media.slug)}`} aria-label={`View ${name}`}>{picture}</Link>:<div className={styles.image}>{picture}</div>;
}
export default function Cart() {
  const [lines, setLines] = useState<ReturnType<typeof cart.get>>([]);
  const [message, setMessage] = useState("");
  const [media,setMedia]=useState<Record<string,ProductMedia>>({});
  const [imageError,setImageError]=useState(false);
  const [retry,setRetry]=useState(0);
  const variantIds=lines.map(line=>line.variant_id).sort().join(",");
  useEffect(() => {
    const refresh = () => setLines(cart.get());
    window.addEventListener("nestling:storage", refresh);
    loadAccountStorage(true).then(refresh).catch(error => setMessage(errorMessage(error)));
    return () => window.removeEventListener("nestling:storage", refresh);
  }, []);
  useEffect(()=>{
    let active=true;setImageError(false);
    if(!variantIds)return;
    const ids=variantIds.split(",");
    if(!isSupabaseConfigured){
      const images:Record<string,ProductMedia>={};
      for(const p of demoProducts)for(const v of p.product_variants)if(ids.includes(v.id))images[v.id]={slug:p.slug,image:[...p.product_images].sort((a,b)=>a.sort_order-b.sort_order)[0]?.url,art:p.art};
      setMedia(images);return;
    }
    (async()=>{try{
      const {data,error}=await sb.from("product_variants").select("id,products(slug,product_images(url,sort_order))").in("id",ids);
      if(error)throw error;
      const images:Record<string,ProductMedia>={};
      for(const row of (data||[]) as unknown as {id:string;products:{slug:string;product_images:{url:string;sort_order:number}[]}|null}[]){
        if(!row.products)continue;
        const image=[...row.products.product_images].sort((a,b)=>a.sort_order-b.sort_order)[0]?.url;
        images[row.id]={slug:row.products.slug,image:image&&/^https?:\/\//i.test(image)?image:undefined};
      }
      if(active)setMedia(images);
    }catch{if(active)setImageError(true);}})();
    return()=>{active=false;};
  },[variantIds,retry]);
  async function remove(id: string) {
    try { const next = lines.filter(line => line.variant_id !== id); await cart.set(next); setLines(next); setMessage(""); }
    catch (error) { setMessage(errorMessage(error)); }
  }
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  return <main><h1>Cart</h1>{!lines.length && <p>Your cart is empty.</p>}
    <div className={styles.items}>{lines.map(line => <article className={styles.item} key={line.variant_id}>
      <CartImage media={media[line.variant_id]} name={line.name}/>
      <div className={styles.details}><h2>{media[line.variant_id]?.slug?<Link href={`/product/${encodeURIComponent(media[line.variant_id].slug)}`}>{line.name}</Link>:line.name}</h2><p>Quantity: {line.qty} <span aria-hidden="true">·</span> {money(line.price)} each</p><button className={styles.remove} onClick={() => remove(line.variant_id)}>Remove</button></div>
      <strong className={styles.total}>{money(line.price * line.qty)}</strong>
    </article>)}</div>
    {imageError&&!!lines.length&&<p className={styles.notice} role="status">Product images could not be loaded. <button className="text-button" onClick={()=>setRetry(v=>v+1)}>Retry images</button></p>}
    <p role="status">{message}</p><h3>Subtotal {money(subtotal)}</h3><small>Final prices and discounts are confirmed by the server at checkout.</small>
    {!!lines.length && <p><Link className="btn" href="/checkout">Checkout</Link></p>}
  </main>;
}
