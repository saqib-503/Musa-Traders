"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {sb,money} from "@/lib/supabase";
import {errorMessage} from "@/lib/utils";
import {ButtonContent, LoadingBlock} from "./Loading";
type Stats={users:number;products:number;active_products:number;featured:number;new_arrivals:number;orders:number;delivered_revenue:number;open_value:number;average_order:number;statuses:{status:string;total:number}[];daily:{day:string;orders:number;revenue:number}[];top_products:{product_id:string;name:string;quantity:number;sales:number}[];low_stock:{name:string;slug:string;color:string;size:string;stock:number}[]};
export default function AdminAnalytics({detailed=false}:{detailed?:boolean}){
 const [stats,setStats]=useState<Stats|null>(null),[days,setDays]=useState(""),[error,setError]=useState(""),[version,setVersion]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);setError("");setStats(null);
  (async()=>{try{const {data,error}=await sb.rpc("admin_analytics",{p_since:days?new Date(Date.now()-Number(days)*86400000).toISOString():null});if(error)throw error;if(active)setStats(data);}catch(e){if(active)setError(errorMessage(e));}finally{if(active)setLoading(false);}})();return()=>{active=false;};
 },[days,version]);
 return <section><div className="account-actions"><label>Order period<select value={days} onChange={e=>setDays(e.target.value)}><option value="">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label><button className="btn refresh-totals-button" disabled={loading} onClick={()=>setVersion(v=>v+1)}><ButtonContent busy={loading} busyLabel="Refreshing totals...">Refresh totals</ButtonContent></button></div>
 {loading&&<LoadingBlock compact label="Loading store totals..."/>}{error&&<p role="alert">{error}</p>}
 {stats&&<><div className="admin-dashboard">{[["Registered users",stats.users],["Products",stats.products],["Orders",stats.orders],["Delivered order value",money(stats.delivered_revenue)],["Open order value",money(stats.open_value)],["Average delivered order",money(stats.average_order)]].map(([label,value])=><article className="admin-stat" key={label}><p>{label}</p><strong>{value}</strong></article>)}</div><p>Cash-on-delivery totals use delivered orders. Pending, confirmed and shipped orders are shown separately. Catalog and user counts cover all time.</p>
 <h2>Low stock</h2>{stats.low_stock.length?<div className="table-scroll"><table><thead><tr><th>Product / variant</th><th>Stock</th></tr></thead><tbody>{stats.low_stock.map((v,i)=><tr key={i}><td><Link href="/admin/products">{v.name}</Link> {[v.color,v.size].filter(Boolean).join(" / ")}</td><td>{v.stock}</td></tr>)}</tbody></table></div>:<p>No active variants with five or fewer units.</p>}
 {detailed&&<><h2>Catalog coverage</h2><p>{stats.active_products} active products · {stats.featured} featured · {stats.new_arrivals} new arrivals</p><h2>Orders by status</h2>{stats.statuses.length?<ul>{stats.statuses.map(s=><li key={s.status}>{s.status}: {s.total}</li>)}</ul>:<p>No orders in this period.</p>}<h2>Delivered sales by day</h2><p>Order dates in Pakistan time; latest 31 days with delivered orders.</p><div className="table-scroll"><table><thead><tr><th>Date</th><th>Orders</th><th>Value</th></tr></thead><tbody>{stats.daily.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.orders}</td><td>{money(d.revenue)}</td></tr>)}</tbody></table></div><h2>Top products</h2><p>Delivered orders, ranked by units. Item sales exclude shipping and order-level discounts.</p>{stats.top_products.length?<div className="table-scroll"><table><thead><tr><th>Product</th><th>Units</th><th>Item sales</th></tr></thead><tbody>{stats.top_products.map(p=><tr key={p.product_id}><td>{p.name}</td><td>{p.quantity}</td><td>{money(p.sales)}</td></tr>)}</tbody></table></div>:<p>No delivered product sales yet.</p>}</>}
 </>}
 </section>;
}
