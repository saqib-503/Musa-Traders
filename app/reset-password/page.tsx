"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { sb, isSupabaseConfigured } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import {ButtonContent, LoadingBlock} from "@/components/Loading";
export default function ResetPassword() {
  const [signedIn, setSignedIn] = useState(false); const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return; }
    const { data } = sb.auth.onAuthStateChange((_event, session) => { setSignedIn(!!session); setLoading(false); });
    return () => data.subscription.unsubscribe();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      if (signedIn) {
        if (password !== confirm) throw new Error("Passwords do not match.");
        const { error } = await sb.auth.updateUser({ password }); if (error) throw error;
        setPassword(""); setConfirm(""); setMessage("Password updated. You can return to your account.");
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error; setMessage("If an account exists for this email, a reset link will arrive shortly.");
      }
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  return <main className="account-form"><h1>Reset password</h1>{!isSupabaseConfigured ? <p>Account recovery will be available once the store is connected.</p> : loading ? <p>Checking session…</p> : <form onSubmit={submit}>
    {signedIn ? <><label>New password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)}/></label><label>Confirm password<input type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={e => setConfirm(e.target.value)}/></label></> : <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}/></label>}
    <button className="btn" disabled={busy}><ButtonContent busy={busy} busyLabel={signedIn ? "Updating password..." : "Sending link..."}>{signedIn ? "Update password" : "Send reset link"}</ButtonContent></button>
  </form>}<p role="status">{message}</p><Link href="/account">Back to account</Link></main>;
}
