"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { isSupabaseConfigured, sb, cart, money } from "@/lib/supabase";
import { checkoutRequest } from "@/lib/storage";
import { loadAccountStorage } from "@/lib/storage";
import { errorMessage } from "@/lib/utils";
import { ButtonContent } from "@/components/Loading";
type PaymentSettings={cod_enabled:boolean;bank_transfer_enabled:boolean;cod_surcharge_percent:number;bank_name:string;account_title:string;account_number:string;iban:string;payment_instructions:string};
export default function Checkout() {
  const [lines, setLines] = useState<ReturnType<typeof cart.get>>([]);
  const [fields, setFields] = useState({ name: "", phone: "", address: "", city: "", coupon: "", payment_reference: "" });
  const [settings,setSettings]=useState<PaymentSettings|null>(null);
  const [paymentMethod,setPaymentMethod]=useState<"cod"|"bank_transfer">("cod");
  const [message, setMessage] = useState("");
  const [orderRef, setOrderRef] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    const refresh = () => setLines(cart.get());
    window.addEventListener("nestling:storage", refresh);
    loadAccountStorage(true).then(refresh).catch(error => setMessage(errorMessage(error)));
    sb.from("store_payment_settings").select("cod_enabled,bank_transfer_enabled,cod_surcharge_percent,bank_name,account_title,account_number,iban,payment_instructions").eq("id",true).single().then(({data,error})=>{if(error)setMessage(errorMessage(error));else if(data){const config={...data,cod_surcharge_percent:Number(data.cod_surcharge_percent||0)} as PaymentSettings;setSettings(config);if(!config.cod_enabled&&config.bank_transfer_enabled)setPaymentMethod("bank_transfer");}});
    return () => window.removeEventListener("nestling:storage", refresh);
  }, []);
  if (!isSupabaseConfigured) return <main><h1>Checkout</h1><p>Checkout is unavailable in preview mode. No orders will be placed.</p><Link href="/cart">Back to cart</Link></main>;
  async function place(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !lines.length) return;
    submitting.current = true; setBusy(true); setTotal(null); setMessage("Placing order...");
    try {
      const { data: { user }, error: authError } = await sb.auth.getUser();
      if (authError || !user) throw new Error("Sign in before placing your order.");
      const payload = {
        items: lines.map(line => ({ variant_id: line.variant_id, qty: line.qty })).sort((a, b) => a.variant_id.localeCompare(b.variant_id)),
        p_name: fields.name.trim(), p_phone: fields.phone.trim(), p_address: fields.address.trim(),
        p_city: fields.city.trim(), p_coupon: fields.coupon.trim().toUpperCase() || null,
        p_payment_method: paymentMethod, p_payment_reference: fields.payment_reference.trim() || null,
      };
      if (!payload.p_name || !payload.p_address || !payload.p_city || payload.p_phone.length < 5)
        throw new Error("Enter a valid name, phone, address and city.");
      const requestId = checkoutRequest(user.id, payload);
      const { data: orderId, error } = await sb.rpc("place_order", { ...payload, p_request_id: requestId });
      if (error) throw error;
      if (!orderId) throw new Error("The order response was incomplete. Retry with the same details.");
      // An accepted order stays successful even if the follow-up total lookup fails.
      setOrderRef(String(orderId)); setLines([]);
      let note = "";
      try { await cart.set([]); localStorage.removeItem("checkout:request"); } catch { note = " Your saved cart could not be cleared. Please remove the ordered items before checking out again."; }
      setMessage(`Order placed. Reference ${orderId}.${paymentMethod === "bank_transfer" ? " Your bank transfer will be verified by the store." : " Pay cash on delivery."}${note}`);
      try {
        const result = await sb.from("orders").select("total").eq("id", orderId).single();
        if (result.error || result.data?.total == null) throw new Error("Total unavailable");
        setTotal(Number(result.data.total));
      } catch { setMessage(`Order placed. Reference ${orderId}. Total is temporarily unavailable; please do not place it again.${note}`); }
    } catch (error) { setMessage(errorMessage(error)); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <main style={{ maxWidth: 560 }}><h1>Checkout</h1>
    <p>{lines.reduce((sum, line) => sum + line.qty, 0)} item(s). <Link href="/login">Sign in</Link> before placing an order.</p>
    <form onSubmit={place}><fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
      {(["name", "phone", "address", "city", "coupon"] as const).map(key => <label key={key}>
        {key[0].toUpperCase() + key.slice(1)}{key === "coupon" ? " (optional)" : ""}
        <input name={key} type={key === "phone" ? "tel" : "text"} required={key !== "coupon"}
          minLength={key === "phone" ? 5 : 1} maxLength={key === "address" ? 500 : key === "phone" ? 30 : 120}
          autoComplete={{ name: "name", phone: "tel", address: "street-address", city: "address-level2", coupon: "off" }[key]}
          value={fields[key]} onChange={event => setFields({ ...fields, [key]: event.target.value })} />
      </label>)}
      <fieldset className="payment-methods"><legend>Payment method</legend>{!settings?<p>Loading payment methods...</p>:<>{settings.cod_enabled&&<label className="payment-choice"><input type="radio" name="payment_method" checked={paymentMethod==="cod"} onChange={()=>setPaymentMethod("cod")}/> <span><strong>Cash on delivery</strong><small>{settings.cod_surcharge_percent>0?`An additional ${settings.cod_surcharge_percent}% COD charge applies.`:"Pay when your parcel arrives."}</small></span></label>}{settings.bank_transfer_enabled&&<label className="payment-choice"><input type="radio" name="payment_method" checked={paymentMethod==="bank_transfer"} onChange={()=>setPaymentMethod("bank_transfer")}/> <span><strong>Advance bank transfer</strong><small>Transfer payment, submit its reference, then Musa Traders will approve it manually.</small></span></label>}{paymentMethod==="bank_transfer"&&settings.bank_transfer_enabled&&<section className="bank-details"><h3>Bank transfer details</h3><p><strong>{settings.bank_name}</strong><br/>Account title: {settings.account_title}<br/>Account number: {settings.account_number}{settings.iban&&<><br/>IBAN: {settings.iban}</>}</p>{settings.payment_instructions&&<p>{settings.payment_instructions}</p>}<label>Transaction / transfer reference<input required minLength={3} maxLength={120} value={fields.payment_reference} onChange={e=>setFields({...fields,payment_reference:e.target.value})} placeholder="Enter your bank transfer reference"/></label></section>}{!settings.cod_enabled&&!settings.bank_transfer_enabled&&<p role="alert">No payment method is currently available.</p>}</>}</fieldset>
      <button className="btn" disabled={!lines.length || busy || !settings || (!settings.cod_enabled&&!settings.bank_transfer_enabled)}><ButtonContent busy={busy} busyLabel="Placing order...">Place order{paymentMethod==="cod"?" (cash on delivery)":" (bank transfer)"}</ButtonContent></button>
    </fieldset></form>{orderRef && <p><Link href="/account">View your orders</Link></p>}<p role="status">{message}{total !== null && ` Total: ${money(total)}`}</p>
  </main>;
}
