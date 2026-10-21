"use client";
import {useEffect,useState} from "react";
import {sb} from "@/lib/supabase";
import {errorMessage} from "@/lib/utils";
import {ButtonContent, LoadingBlock} from "./Loading";
type Notice={id:string;message:string;read_at:string|null;created_at:string};
export default function AccountNotifications({userId}:{userId:string}){
 const [rows,setRows]=useState<Notice[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
 useEffect(()=>{let active=true;setRows([]);setError("");setLoading(true);sb.from("notifications").select("id,message,read_at,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(20).then(({data,error})=>{if(!active)return;if(error)setError(errorMessage(error));else setRows(data||[]);setLoading(false);});return()=>{active=false;};},[userId,version]);
 async function markRead(){if(busy)return;setBusy(true);try{const {error}=await sb.from("notifications").update({read_at:new Date().toISOString()}).eq("user_id",userId).in("id",rows.filter(r=>!r.read_at).map(r=>r.id));if(error)throw error;setVersion(v=>v+1);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 return <section><h2>Order updates</h2>{error&&<p role="alert">{error}</p>}{loading?<LoadingBlock compact label="Loading order updates..."/>: <>{!error&&!rows.length&&<p>No order updates yet.</p>}<ul>{rows.map(r=><li key={r.id}>{!r.read_at&&<strong>New: </strong>}{r.message} <small>{new Date(r.created_at).toLocaleDateString()}</small></li>)}</ul></>}<div className="account-actions"><button disabled={busy||loading} onClick={()=>setVersion(v=>v+1)}><ButtonContent busy={loading} busyLabel="Refreshing...">Refresh updates</ButtonContent></button>{rows.some(r=>!r.read_at)&&<button disabled={busy} onClick={markRead}><ButtonContent busy={busy} busyLabel="Marking as read...">Mark displayed updates as read</ButtonContent></button>}</div></section>;
}
