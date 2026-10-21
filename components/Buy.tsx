"use client";
import { useState } from "react";
import { cart, money, type Product } from "@/lib/supabase";
import { compare } from "@/lib/storage";
import { loadAccountStorage } from "@/lib/storage";
import { useRef } from "react";
import { errorMessage } from "@/lib/utils";
import {ButtonContent} from "./Loading";
export default function Buy({ id, name, price, variants }: { id: string; name: string; price: number; variants: Product["product_variants"] }) {
  const [vid, setVid] = useState(variants.find(v => v.stock > 0)?.id || "");
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const variant = variants.find(v => v.id === vid);
  const unitPrice = variant?.price_override ?? price;
  async function add() {
    if (!variant || variant.stock < 1) return;
    if (saving.current) return;
    saving.current = true; setBusy(true);
    try {
      if (!await loadAccountStorage(true)) return;
      const lines = cart.get();
      const line = lines.find(l => l.variant_id === variant.id);
      const limit = Math.min(20, variant.stock);
      if (line && line.qty >= limit) return setMessage(`Maximum available quantity is ${limit}.`);
      if (line) { line.qty++; line.price = unitPrice; }
      else lines.push({ variant_id: variant.id, name: [name, variant.color, variant.configuration].filter(Boolean).join(" / "), price: unitPrice, qty: 1 });
      await cart.set(lines); setMessage("Added to cart");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { saving.current = false; setBusy(false); }
  }
  function addCompare() {
    try { compare.add(id); setMessage("Added to compare"); }
    catch (error) { setMessage(errorMessage(error)); }
  }
  return <div><h3>{money(unitPrice)}</h3><label>Option<select value={vid} onChange={event => setVid(event.target.value)}>
    {!vid && <option value="">Sold out</option>}
    {variants.map(v => <option key={v.id} value={v.id} disabled={v.stock < 1}>
      {[v.color, v.configuration].filter(Boolean).join(" / ") || "Standard"}{v.stock < 1 ? " (sold out)" : ""}
    </option>)}
  </select></label><button className="btn" onClick={add} disabled={busy || !variant || variant.stock < 1}><ButtonContent busy={busy} busyLabel="Adding...">Add to cart</ButtonContent></button>{" "}
    <button className="btn" style={{ background: "#667089" }} onClick={addCompare}>Compare</button><p role="status">{message}</p>
  </div>;
}
