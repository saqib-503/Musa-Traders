"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { sb, CARD_COLS, isSupabaseConfigured, type Product } from "@/lib/supabase";
import { demoProducts } from "@/lib/demo";
import { favourites, loadAccountStorage } from "@/lib/storage";
import { errorMessage } from "@/lib/utils";
import Card from "@/components/Card";
import {LoadingBlock} from "@/components/Loading";
export default function Wishlist() {
  const [products, setProducts] = useState<Product[]>([]); const [message, setMessage] = useState("Loading your favourites...");
  useEffect(() => {
    let active = true; let version = 0;
    async function refresh() {
      const current = ++version;
      try {
        const ids = favourites.get(); let data: Product[] = [];
        if (isSupabaseConfigured && ids.length) {
          const result = await sb.from("products").select(CARD_COLS).eq("status", "active").in("id", ids);
          if (result.error) throw result.error; data = (result.data || []) as unknown as Product[];
        } else if (!isSupabaseConfigured) data = demoProducts.filter(product => ids.includes(product.id));
        if (active && version === current) { setProducts(data); setMessage(data.length ? "" : "A little list of things you love. Tap a heart to save your favourites here."); }
      } catch (error) { if (active && version === current) setMessage(errorMessage(error)); }
    }
    loadAccountStorage(true).then(refresh).catch(error => setMessage(errorMessage(error))); window.addEventListener("nestling:storage", refresh); window.addEventListener("storage", refresh);
    return () => { active = false; window.removeEventListener("nestling:storage", refresh); window.removeEventListener("storage", refresh); };
  }, []);
  return <main><h1>Your wishlist</h1>{message==="Loading your favourites..."?<LoadingBlock label={message}/>:<p role="status">{message}</p>}{products.length ? <div className="product-grid">{products.map(product => <Card key={product.id} p={product}/>)}</div> : message!=="Loading your favourites..."&&<Link className="btn" href="/#products">Explore the collection</Link>}</main>;
}
