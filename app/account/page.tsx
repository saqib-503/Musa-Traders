"use client";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {useRouter,useSearchParams} from "next/navigation";
import AccountNotifications from "@/components/AccountNotifications";
import { sb, isSupabaseConfigured } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import OrderDetails, { ORDER_COLUMNS, type StoreOrder } from "@/components/OrderDetails";
import {ButtonContent, LoadingBlock} from "@/components/Loading";
export default function Account() {
  return <Suspense fallback={<LoadingBlock label="Loading your account..."/>}><AccountContent/></Suspense>;
}
function AccountContent() {
  const router=useRouter();
  const personalView=useSearchParams().get("view")==="profile";
  const [redirecting,setRedirecting]=useState(false);
  const [profile, setProfile] = useState<{ id: string; full_name: string; phone: string; role: string } | null>(null);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    const { data } = sb.auth.onAuthStateChange(() => setVersion(v => v + 1));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    async function load() {
      setLoading(true); setRedirecting(false); setMessage(""); setProfile(null); setOrders([]);
      try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) { if (active) { setProfile(null); setOrders([]); } return; }
        const person=await sb.from("profiles").select("id,full_name,phone,role").eq("id",user.id).single();
        if(person.error)throw person.error;
        if(!active)return;
        if(person.data.role==="admin"&&!personalView){setRedirecting(true);router.replace("/admin");return;}
        const history=await sb.from("orders").select(ORDER_COLUMNS).eq("user_id",user.id).order("created_at",{ascending:false});
        if(history.error)throw history.error;
        if (active) { setProfile({ ...person.data, full_name: person.data.full_name || "", phone: person.data.phone || "" }); setOrders((history.data || []) as unknown as StoreOrder[]); }
      } catch (error) { if (active) setMessage(errorMessage(error)); }
      finally { if (active) setLoading(false); }
    }
    void load(); return () => { active = false; };
  }, [version,personalView,router]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!profile || busy) return; setBusy(true);
    try {
      const { error } = await sb.from("profiles").update({ full_name: profile.full_name.trim(), phone: profile.phone.trim() }).eq("id", profile.id).select("id").single();
      if (error) throw error; setMessage("Profile saved.");
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  async function signOut() {
    if (busy) return; setBusy(true);
    try { const { error } = await sb.auth.signOut(); if(error)throw error; setProfile(null); setOrders([]); }
    catch(error){setMessage(errorMessage(error));} finally {setBusy(false);}
  }
  if (!isSupabaseConfigured) return <main><h1>Your account</h1><p>Accounts and order history will be available once the store is connected.</p></main>;
  if(redirecting)return <main><p role="status">Opening admin panel...</p></main>;
  return <main><h1>Your account</h1><p role="status">{message}</p>{loading ? <p>Loading your account…</p> : profile ? <>
    <div className="account-actions">{profile.role === "admin" && <Link className="btn" href="/admin">Open admin panel</Link>}<Link href="/reset-password">Change password</Link><button className="btn btn-secondary" disabled={busy} onClick={signOut}><ButtonContent busy={busy} busyLabel="Signing out...">Sign out</ButtonContent></button></div>
    <form className="account-form" onSubmit={save}><label>Full name<input required maxLength={120} value={profile.full_name} onChange={e => setProfile({ ...profile, full_name: e.target.value })}/></label><label>Phone<input type="tel" maxLength={30} value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })}/></label><button className="btn" disabled={busy}><ButtonContent busy={busy} busyLabel="Saving profile...">Save profile</ButtonContent></button></form>
    <AccountNotifications key={profile.id} userId={profile.id}/><h2>Your orders</h2>{orders.length ? orders.map(order => <OrderDetails key={order.id} order={order}/>) : <p>No orders yet. <Link href="/#products">Explore the store</Link>.</p>}
  </> : <p><Link className="btn" href="/login">Sign in or create an account</Link></p>}<button className="text-button" onClick={() => setVersion(v => v + 1)}>Refresh account</button></main>;
}
