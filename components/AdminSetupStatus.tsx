"use client";
import {useEffect,useState} from "react";
import {sb,isSupabaseConfigured} from "@/lib/supabase";
export default function AdminSetupStatus({children}:{children:React.ReactNode}){
 const [message,setMessage]=useState("");
 const [ready,setReady]=useState(!isSupabaseConfigured),[version,setVersion]=useState(0);
 useEffect(()=>{if(!isSupabaseConfigured)return;let active=true;setReady(false);setMessage("");sb.rpc("backend_version").then(({data,error})=>{const current=String(data||"");const compatible=/^\d{8}$/.test(current)&&current>="20261002";if(active){setMessage(error?"Could not check the backend version.":!compatible?"Admin upgrade required: run supabase/migrations/20261002_admin_features.sql and all later migrations in order in Supabase SQL Editor, then refresh this page.":"");setReady(!error&&compatible);}});return()=>{active=false;};},[version]);
 if(message)return <div className="admin-notice"><p role="status">{message}</p><button onClick={()=>setVersion(v=>v+1)}>Check again</button></div>;
 return ready?<>{children}</>:<p role="status">Checking admin setup...</p>;
}
