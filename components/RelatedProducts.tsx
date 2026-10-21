"use client";
import {useEffect,useState} from "react";
import {sb,CARD_COLS,type Product} from "@/lib/supabase";
import ProductGrid from "./ProductGrid";
import {errorMessage} from "@/lib/utils";
export default function RelatedProducts({productId}:{productId:string}){
 const [products,setProducts]=useState<Product[]>([]),[error,setError]=useState("");
 useEffect(()=>{let active=true;(async()=>{try{const links=await sb.from("related_products").select("related_product_id").eq("product_id",productId);if(links.error)throw links.error;if(!links.data?.length){if(active)setProducts([]);return;}const result=await sb.from("products").select(CARD_COLS).in("id",links.data.map(r=>r.related_product_id)).eq("status","active");if(result.error)throw result.error;if(active)setProducts((result.data||[]) as unknown as Product[]);}catch(e){if(active)setError(errorMessage(e));}})();return()=>{active=false;};},[productId]);
 return error?<p role="alert">Could not load related products: {error}</p>:products.length?<ProductGrid products={products} title="You may also like"/>:null;
}
