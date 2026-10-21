"use client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { money, type Product } from "@/lib/supabase";
import { cart, favourites } from "@/lib/storage";
import { loadAccountStorage } from "@/lib/storage";
import { useRef } from "react";
import { errorMessage } from "@/lib/utils";
import { Bag, Heart } from "./Icons";
import {ButtonContent} from "./Loading";
export default function Card({ p }: { p: Product }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [added, setAdded] = useState(false);
  const badge = p.badge || (p.new_arrival ? "New" : p.best_seller ? "Best seller" : p.featured ? "Featured" : "");
  const img = [...p.product_images].sort((a, b) => a.sort_order - b.sort_order)[0];
  const variant = p.product_variants.find(value => value.stock > 0);
  const price = variant?.price_override ?? p.sale_price ?? p.regular_price;
  const colors = [...new Set(p.product_variants.map(v => v.color?.trim()).filter((c): c is string => Boolean(c)))];
  const configurations = [...new Set(p.product_variants.map(v => v.configuration?.trim()).filter((s): s is string => Boolean(s)))];
  const totalStock = p.product_variants.reduce((sum, v) => sum + Math.max(0, v.stock), 0);
  const discount = p.regular_price > price && p.regular_price > 0 ? Math.round((1 - price / p.regular_price) * 100) : 0;
  const reviews = (p.product_reviews || []).filter(r => r.approved);
  const rating = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
  useEffect(() => {
    const refresh = () => setSaved(favourites.get().includes(p.id)); refresh();
    window.addEventListener("nestling:storage", refresh); window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("nestling:storage", refresh); window.removeEventListener("storage", refresh); };
  }, [p.id]);
  async function save() {
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try { if (await loadAccountStorage(true)) await favourites.toggle(p.id); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  async function add(goToCheckout = false) {
    if (!variant) return;
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      if (!await loadAccountStorage(true)) return;
      const lines = cart.get(); const existing = lines.find(line => line.variant_id === variant.id);
      if (existing && existing.qty >= Math.min(20, variant.stock)) return setMessage("Maximum available quantity is in your cart.");
      if (existing) { existing.qty++; existing.price = price; }
      else {
        if (lines.length >= 100) return setMessage("Your cart is full.");
        lines.push({ variant_id: variant.id, name: [p.name, variant.color, variant.configuration].filter(Boolean).join(" / "), price, qty: 1 });
      }
      await cart.set(lines); setAdded(true); setMessage("");
      if (goToCheckout) router.push("/checkout");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  return <article className="product-card polished-card">
    <div className={`product-art tone-${p.tone || "blue"}`}>
      <Link className="product-image-link" href={`/product/${p.slug}`} aria-label={`View ${p.name}`}>
        {img ? <Image src={img.url} alt={img.alt || p.name} width={460} height={320} /> : <span className="product-emoji" aria-hidden="true">{p.art || "🧸"}</span>}
      </Link>
      {badge && <span className="product-badge">{badge}</span>}
      <button className={`favourite-button ${saved ? "is-saved" : ""}`} aria-label={`${saved ? "Remove" : "Save"} ${p.name} ${saved ? "from" : "to"} wishlist`} aria-pressed={saved} disabled={busy} onClick={save}><Heart filled={saved} /></button>
      <Link className="quick-view-button" href={`/product/${p.slug}`}>Quick view</Link>
    </div>
    <div className="product-info"><p className="product-brand">{p.brands?.name || "Musa Traders"}</p><Link className="product-name" href={`/product/${p.slug}`}>{p.name}</Link>
      {reviews.length > 0 && <p className="card-rating" aria-label={`${rating.toFixed(1)} out of 5 stars, ${reviews.length} reviews`}><span aria-hidden="true">&#9733;</span> {rating.toFixed(1)} <span className="card-review-count">({reviews.length} reviews)</span></p>}
      {(colors.length > 0 || configurations.length > 0) && <div className="card-options">
        {colors.length > 0 && <div className="card-colors" aria-label="Available colors">{colors.slice(0, 4).map(color => <span className="card-color" key={color} title={color}><i style={{backgroundColor: color.toLowerCase()}} aria-hidden="true"/>{color}</span>)}{colors.length > 4 && <span>+{colors.length - 4}</span>}</div>}
        {configurations.length > 0 && <p className="card-sizes">Options: {configurations.slice(0, 4).join(" / ")}{configurations.length > 4 ? ` +${configurations.length - 4}` : ""}</p>}
      </div>}
      <div className="card-price-line"><p className="product-price"><strong>{money(price)}</strong>{price < p.regular_price && <s>{money(p.regular_price)}</s>}</p>{discount > 0 && <span className="card-discount">{discount}% OFF</span>}</div>
      {totalStock > 0 && totalStock <= 5 && <p className="card-stock">Only {totalStock} left in stock</p>}
      <div className="card-actions"><button className="add-button" disabled={busy || !variant} onClick={()=>add()}>{!busy&&<Bag/>}<ButtonContent busy={busy} busyLabel="Adding...">{!variant ? "Sold out" : added ? "Added \u2713" : "Add to cart"}</ButtonContent></button><button className="buy-now-button" disabled={busy || !variant} onClick={()=>add(true)}><ButtonContent busy={busy} busyLabel="Preparing...">Buy now</ButtonContent></button></div>
      {message && <p className="card-message" role="status">{message}</p>}
    </div>
  </article>;
}
