"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import { ButtonContent, LoadingBlock } from "./Loading";

type Notice={id:string;order_id:string|null;review_id:string|null;kind:string;message:string;read_at:string|null;created_at:string};
const label:Record<string,string>={new_order:"New order",bank_transfer:"Payment verification",pending_review:"Review to approve"};
export default function AdminNotifications(){
 const [rows,setRows]=useState<Notice[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[version,setVersion]=useState(0);
 useEffect(()=>{let active=true;setLoading(true);setMessage("");sb.from("admin_notifications").select("id,order_id,review_id,kind,message,read_at,created_at").order("created_at",{ascending:false}).limit(100).then(({data,error})=>{if(!active)return;if(error)setMessage(errorMessage(error));else setRows((data||[]) as Notice[]);setLoading(false);});return()=>{active=false;};},[version]);
 async function mark(ids:string[]){if(!ids.length||busy)return;setBusy(true);try{const {error}=await sb.from("admin_notifications").update({read_at:new Date().toISOString()}).in("id",ids);if(error)throw error;setRows(current=>current.map(row=>ids.includes(row.id)?{...row,read_at:new Date().toISOString()}:row));}catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}}
 const unread=rows.filter(row=>!row.read_at);
 return <><div className="notification-heading"><div><h1>Notifications</h1><p>New orders, manual bank-transfer checks and pending customer reviews appear here.</p></div><div className="account-actions"><button className="btn btn-secondary" disabled={loading||busy} onClick={()=>setVersion(value=>value+1)}><ButtonContent busy={loading} busyLabel="Refreshing...">Refresh</ButtonContent></button>{unread.length>0&&<button className="btn" disabled={busy} onClick={()=>mark(unread.map(row=>row.id))}><ButtonContent busy={busy} busyLabel="Marking...">Mark all as read</ButtonContent></button>}</div></div>{message&&<p role="alert">{message}</p>}{loading?<LoadingBlock compact label="Loading admin notifications..."/>:rows.length?<div className="admin-notification-list">{rows.map(row=>{const href=row.order_id?`/admin/orders/${row.order_id}`:row.review_id?"/admin/reviews":"/admin";return <article className={`admin-notification ${row.read_at?"":"is-unread"}`} key={row.id}><Link href={href} onClick={()=>!row.read_at&&void mark([row.id])}><span className="notification-kind">{label[row.kind]||"Update"}</span><strong>{row.message}</strong><time>{new Date(row.created_at).toLocaleString("en-PK",{dateStyle:"medium",timeStyle:"short"})}</time></Link>{!row.read_at&&<button type="button" className="text-button" disabled={busy} onClick={()=>mark([row.id])}>Mark read</button>}</article>;})}</div>:<div className="empty-state"><h2>You are all caught up</h2><p>New store activity will appear here.</p></div>}</>;
}
