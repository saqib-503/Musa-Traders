"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { sb, isSupabaseConfigured } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import {LoadingBlock} from "./Loading";
export default function AdminGate({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured) return <main><h1>Admin</h1><p>Store administration will be available once the store is connected.</p></main>;
  return <ConnectedAdminGate>{children}</ConnectedAdminGate>;
}
function ConnectedAdminGate({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const { data } = sb.auth.onAuthStateChange(() => { setAllowed(null); setVersion(value => value + 1); });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let active = true;
    setMessage("");
    async function check() {
      try {
        const { data, error } = await sb.rpc("is_admin");
        if (error) throw error;
        if (active) setAllowed(data === true);
      } catch (error) { if (active) { setMessage(errorMessage(error)); setAllowed(false); } }
    }
    void check(); return () => { active = false; };
  }, [version]);
  if (allowed === null) return <LoadingBlock label="Checking administrator access..."/>;
  if (message) return <p role="alert">{message} <button onClick={() => { setAllowed(null); setVersion(v => v + 1); }}>Retry</button></p>;
  if (!allowed) return <p>Admins only. <Link href="/login">Sign in</Link></p>;
  return <>{children}</>;
}
