"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { sb } from "@/lib/supabase";
import { Bell } from "./Icons";

export default function AdminNotificationBell() {
  const [count,setCount]=useState(0);
  useEffect(()=>{let active=true;async function load(){const {count,error}=await sb.from("admin_notifications").select("id",{count:"exact",head:true}).is("read_at",null);if(active&&!error)setCount(count||0);}void load();const timer=window.setInterval(load,30000);window.addEventListener("focus",load);return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",load);};},[]);
  return <Link className="icon-button admin-notification-button" href="/admin/notifications" aria-label={`${count} unread admin notifications`} title="Admin notifications"><Bell/>{count>0&&<span className="count">{count>99?"99+":count}</span>}</Link>;
}
