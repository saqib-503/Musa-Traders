"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cart, favourites, clearAccountStorage, loadAccountStorage } from "@/lib/storage";
import { sb, isSupabaseConfigured } from "@/lib/supabase";
import { Heart, Bag, LogOut } from "./Icons";
import AdminNotificationBell from "./AdminNotificationBell";
import ThemeToggle from "./ThemeToggle";
import { Spinner } from "./Loading";

export default function Header() {
  const router = useRouter();
  const [account, setAccount] = useState<{ name: string; href: string; isAdmin:boolean } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    async function loadAccount() {
      const { data: { user } } = await sb.auth.getUser();
      if (!active) return;
      if (!user) { setAccount(null); return; }
      const fallback = user.user_metadata?.full_name || user.email?.split("@")[0] || "My account";
      const profile = await sb.from("profiles").select("full_name,role").eq("id", user.id).maybeSingle();
      if (!active) return;
      setAccount({ name: profile.data?.full_name?.trim() || fallback, href: profile.data?.role === "admin" ? "/admin" : "/account", isAdmin:profile.data?.role === "admin" });
    }
    const refresh = () => { if (active) void loadAccountStorage().catch(() => {}); };
    const {data: {subscription}} = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { clearAccountStorage(); setAccount(null); }
      if (event === "SIGNED_IN") clearAccountStorage();
      setTimeout(refresh, 0);
      setTimeout(() => void loadAccount(), 0);
    });
    void loadAccount();
    window.addEventListener("focus", refresh);
    return () => { active = false; subscription.unsubscribe(); window.removeEventListener("focus", refresh); };
  }, []);
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
      clearAccountStorage(); setAccount(null); router.push("/"); router.refresh();
    } finally { setSigningOut(false); }
  }
  const [counts, setCounts] = useState({ cart: 0, favourites: 0 });
  useEffect(() => {
    const refresh = () => setCounts({ cart: cart.get().reduce((sum, item) => sum + item.qty, 0), favourites: favourites.get().length });
    refresh(); window.addEventListener("storage", refresh); window.addEventListener("nestling:storage", refresh);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("nestling:storage", refresh); };
  }, []);
  return <header className="site-header"><div className="shell header-inner">
    <Link className="wordmark" href="/" aria-label="Musa Traders home"><span className="brand-logo" aria-hidden="true"><img src="/brand/musa-traders-horizontal-logo.png" alt="" /></span></Link>
    <form action="/#products" className="header-search" role="search"><input aria-label="Search products or brands" name="q" placeholder="Search products or brands" /></form>
    <div className="header-actions"><ThemeToggle/>{account ? <Link className="header-account-link account-summary" href={account.href} aria-label={`Open ${account.name}'s account`}><span className="account-avatar" aria-hidden="true">{account.name.trim().charAt(0).toUpperCase()}</span><span>{account.name}</span></Link> : <Link className="header-account-link" href="/login">Login</Link>}{account?.isAdmin&&<AdminNotificationBell/>}<Link className="icon-button" href="/wishlist" aria-label={`Wishlist, ${counts.favourites} items`}><Heart/><span className="count">{counts.favourites}</span></Link>
      <Link className="icon-button" href="/cart" aria-label={`Cart, ${counts.cart} items`}><Bag/><span className="count">{counts.cart}</span></Link>{account&&<button className="sign-out-button" type="button" onClick={signOut} disabled={signingOut} aria-label="Sign out" title="Sign out">{signingOut?<Spinner size="small" label="Signing out"/>:<LogOut/>}<span>{signingOut?"Signing out...":"Logout"}</span></button>}</div>
  </div></header>;
}
