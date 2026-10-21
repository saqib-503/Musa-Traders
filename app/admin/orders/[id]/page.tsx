"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AdminGate from "@/components/AdminGate";
import OrderDetails, { ORDER_COLUMNS, type StoreOrder } from "@/components/OrderDetails";
import { ButtonContent, LoadingBlock } from "@/components/Loading";
import { nextOrderStatus, orderStatusLabel } from "@/lib/orders";
import { sb } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";

type History = { id: string; status: string; note: string | null; created_at: string };
export default function Page() { return <AdminGate><OrderManager/></AdminGate>; }
function OrderManager() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [history, setHistory] = useState<History[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  async function load() {
    setLoading(true); setMessage("");
    try {
      const [orderResult, historyResult] = await Promise.all([
        sb.from("orders").select(ORDER_COLUMNS).eq("id", id).maybeSingle(),
        sb.from("order_status_history").select("id,status,note,created_at").eq("order_id", id).order("created_at", { ascending: true }),
      ]);
      if (orderResult.error) throw orderResult.error;
      if (historyResult.error) throw historyResult.error;
      setOrder(orderResult.data as unknown as StoreOrder | null);
      setHistory((historyResult.data || []) as History[]);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [id]);
  async function advance(status: string) {
    if (!order || lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const result = await sb.rpc("update_order_status", { p_order_id: order.id, p_status: status, p_note: note.trim() || null });
      if (result.error) throw result.error;
      setNote(""); setMessage(`Order marked as ${orderStatusLabel[status] || status}.`); await load();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function updatePayment(paymentStatus: string) {
    if (!order || lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    try {
      const result = await sb.rpc("update_order_payment", { p_order_id: order.id, p_payment_status: paymentStatus });
      if (result.error) throw result.error;
      setMessage(`Payment marked as ${paymentStatus.replaceAll("_", " ")}.`); await load();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (loading) return <LoadingBlock label="Loading order details..."/>;
  if (!order) return <><p role="alert">{message || "Order not found."}</p><Link href="/admin/orders">Back to orders</Link></>;
  const next = nextOrderStatus(order.status);
  const canCancel = !["cancelled", "handed_to_courier", "out_for_delivery", "delivered"].includes(order.status);
  return <section className="order-manager"><Link className="back-link" href="/admin/orders">← All orders</Link><div className="order-manager-heading"><div><p className="eyebrow">Order #{order.id.slice(0,8).toUpperCase()}</p><h1>Fulfilment</h1></div><span className={`status-pill status-${order.status}`}>{orderStatusLabel[order.status] || order.status}</span></div><p role="status">{message}</p><div className="order-manager-grid"><section className="order-panel"><h2>Customer & items</h2><OrderDetails order={order}/></section><section className="order-panel"><h2>Payment</h2><p><strong>{order.payment_method==="bank_transfer"?"Advance bank transfer":"Cash on delivery"}</strong><br/>Payment status: <span className="status-pill">{(order.payment_status||"unpaid").replaceAll("_"," ")}</span>{order.payment_reference&&<><br/>Transfer reference: {order.payment_reference}</>}</p><label>Set payment status<select value={order.payment_status||"unpaid"} disabled={busy} onChange={e=>void updatePayment(e.target.value)}><option value="unpaid">Unpaid</option><option value="pending_verification">Pending verification</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="refunded">Refunded</option></select></label><p className="form-hint">For bank transfer, verify the transfer reference before marking the order paid.</p></section><section className="order-panel"><h2>Update fulfilment</h2><p>Move the order through its delivery stages. Each update is saved to the timeline and shown to the customer.</p><label>Internal note (optional)<textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Example: TCS tracking number, delivery instruction..."/></label><div className="account-actions">{next&&<button className="btn" disabled={busy} onClick={()=>advance(next)}><ButtonContent busy={busy} busyLabel="Updating...">Mark as {orderStatusLabel[next]}</ButtonContent></button>}{canCancel&&<button className="btn btn-secondary" disabled={busy} onClick={()=>advance("cancelled")}><ButtonContent busy={busy} busyLabel="Cancelling...">Cancel order</ButtonContent></button>}{["delivered","cancelled"].includes(order.status)&&<p>This order is complete.</p>}</div></section></div><section className="order-panel"><h2>Order timeline</h2><ol className="order-timeline">{history.map(item=><li key={item.id}><span className="timeline-dot"/><div><strong>{orderStatusLabel[item.status] || item.status}</strong><time>{new Date(item.created_at).toLocaleString()}</time>{item.note&&<p>{item.note}</p>}</div></li>)}</ol>{!history.length&&<p>No timeline entries yet. Run the order fulfilment migration in Supabase SQL Editor, then refresh.</p>}</section></section>;
}
