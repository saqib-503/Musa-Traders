"use client";
import { useEffect, useState } from "react";
import { isSupabaseConfigured, sb, money, type Product } from "@/lib/supabase";
import { demoProducts } from "@/lib/demo";
import { compare } from "@/lib/storage";
import { errorMessage } from "@/lib/utils";
import {LoadingBlock} from "@/components/Loading";
type Row = Pick<Product, "id" | "name" | "regular_price" | "sale_price" | "short_description" | "brands">;
export default function Compare() {
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState("Loading...");
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const ids = compare.get();
        if (!ids.length) { if (active) setMessage("Add products with the Compare button on a product page."); return; }
        if (!isSupabaseConfigured) { const products = demoProducts.filter(p => ids.includes(p.id)); if(active){setRows(products);setMessage(products.length ? "" : "These products are no longer available.");} return; }
        const { data, error } = await sb.from("products").select("id,name,regular_price,sale_price,short_description,brands(name)").eq("status", "active").in("id", ids);
        if (error) throw error;
        if (active) { setRows((data || []) as unknown as Row[]); setMessage(data?.length ? "" : "These products are no longer available."); }
      } catch (error) { if (active) setMessage(errorMessage(error)); }
    }
    void load(); return () => { active = false; };
  }, []);
  return <main><h1>Compare</h1>{message==="Loading..."?<LoadingBlock compact label="Loading comparison..."/>:<p role="status">{message}</p>}<div style={{ overflowX: "auto" }}><table><tbody>
    <tr><th>Product</th>{rows.map(row => <td key={row.id}><b>{row.name}</b></td>)}</tr>
    <tr><th>Brand</th>{rows.map(row => <td key={row.id}>{row.brands?.name}</td>)}</tr>
    <tr><th>Price</th>{rows.map(row => <td key={row.id}>{money(row.sale_price ?? row.regular_price)}</td>)}</tr>
    <tr><th>About</th>{rows.map(row => <td key={row.id}>{row.short_description}</td>)}</tr>
  </tbody></table></div></main>;
}
