"use client";
import { useEffect, useRef, useState } from "react";
import { sb, money } from "@/lib/supabase";
import { errorMessage } from "@/lib/utils";
import { ORDER_COLUMNS, type StoreOrder } from "@/components/OrderDetails";
import AdminGate from "@/components/AdminGate";
import {ButtonContent, LoadingBlock} from "@/components/Loading";
import Link from "next/link";
import { ORDER_STATUSES, orderStatusLabel } from "@/lib/orders";
export default function Page() { return <AdminGate><Orders /></AdminGate>; }
function Orders() {
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search,setSearch]=useState(""); const [statusFilter,setStatusFilter]=useState("");
  const locked = useRef(false);
  async function load() {
    setLoading(true); try {
      const result = await sb.from("orders").select(ORDER_COLUMNS).order("created_at", { ascending: false });
      if (result.error) throw result.error;
      setOrders((result.data || []) as unknown as StoreOrder[]);
    } catch (error) { setMessage(errorMessage(error)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function update(id: string, status: string) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage("Updating order...");
    try {
      const result = await sb.rpc("update_order_status", { p_order_id: id, p_status: status, p_note: null });
      if (result.error) throw result.error;
      setMessage(status === "cancelled" ? "Order cancelled and stock restored." : "Order updated.");
      await load();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { locked.current = false; setBusy(false); }
  }
  return <><h1>Orders</h1><p>Open an order to review customer details, items and the delivery timeline. Customers receive an in-app update at each status change.</p><p role="status">{message}</p><button onClick={load} disabled={busy||loading}><ButtonContent busy={loading} busyLabel="Refreshing...">Refresh</ButtonContent></button><div className="account-actions"><label>Search orders<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Reference, name, phone or city"/></label><label>Filter status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="">All statuses</option>{ORDER_STATUSES.map(s=><option key={s} value={s}>{orderStatusLabel[s]}</option>)}</select></label></div>{loading?<LoadingBlock compact label="Loading orders..."/>:
    <><div className="table-scroll"><table><thead><tr><th>Reference / date</th><th>Customer</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
      {orders.filter(o=>(!statusFilter||o.status===statusFilter)&&[o.id,o.name,o.phone,o.city].join(" ").toLowerCase().includes(search.toLowerCase())).map(order => <tr key={order.id}><td>#{order.id.slice(0, 8).toUpperCase()}<br/>{new Date(order.created_at).toLocaleDateString()}</td><td>{order.name}<br/><small>{order.phone} · {order.city}</small></td><td>{money(order.total)}</td><td><span className={`status-pill status-${order.status}`}>{orderStatusLabel[order.status] || order.status}</span></td><td><Link className="text-button" href={`/admin/orders/${order.id}`}>Manage</Link></td></tr>)}
    </tbody></table></div>{!orders.length&&<p>No orders yet.</p>}</>}</>;
}
