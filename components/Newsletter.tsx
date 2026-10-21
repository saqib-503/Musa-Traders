"use client";
import { useState, type FormEvent } from "react";
import { sb, isSupabaseConfigured } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import {ButtonContent} from "./Loading";
export default function Newsletter() {
  const [email, setEmail] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function subscribe(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (!isSupabaseConfigured) return setMessage("Email signup will open when the store launches. This is a preview.");
    setBusy(true);
    try {
      const { error } = await sb.from("newsletter").insert({ email: email.trim().toLowerCase() });
      if (error && error.code !== "23505") throw error;
      setMessage("Thank you! You're on the list."); setEmail("");
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  }
  return <section className="newsletter"><div><h2>{isSupabaseConfigured ? "Little updates, lovely discoveries" : "Extra 10% off your first order"}</h2>
    <p>{isSupabaseConfigured ? "Join our list for new arrivals and store updates." : <>Use code <code>WELCOME10</code> at checkout, or join our list for new arrivals.</>}</p></div>
    <form onSubmit={subscribe}><div className="subscribe-fields"><input aria-label="Your email" placeholder="Your email" type="email" required value={email} onChange={event => setEmail(event.target.value)}/><button className="btn" disabled={busy}><ButtonContent busy={busy} busyLabel="Subscribing...">Subscribe</ButtonContent></button></div><p className="form-message" role="status">{message}</p></form>
  </section>;
}
