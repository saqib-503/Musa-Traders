import { money } from "@/lib/supabase";
import { orderStatusLabel } from "@/lib/orders";
export type StoreOrder = {
  id: string; name: string; phone: string; address: string; city: string; status: string; created_at: string;
  subtotal: number; discount: number; shipping: number; cod_surcharge?: number; total: number; coupon_code: string | null; payment_method?: string; payment_status?: string; payment_reference?: string | null;
  order_items: { id: string; name: string; qty: number; unit_price: number }[];
};
export const ORDER_COLUMNS = "id,name,phone,address,city,status,created_at,subtotal,discount,shipping,cod_surcharge,total,coupon_code,payment_method,payment_status,payment_reference,order_items(id,name,qty,unit_price)";
export default function OrderDetails({ order }: { order: StoreOrder }) {
  return <details className="order-details"><summary>Order {order.id.slice(0, 8)} <span className={`status-pill status-${order.status}`}>{orderStatusLabel[order.status] || order.status}</span> <strong>{money(order.total)}</strong></summary>
    <p>Reference: {order.id}<br/>{order.name} · {order.phone}<br/>{order.address}, {order.city}</p>
    <div className="table-scroll"><table><thead><tr><th>Product</th><th>Quantity</th><th>Price</th></tr></thead><tbody>{order.order_items.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.qty}</td><td>{money(item.unit_price * item.qty)}</td></tr>)}</tbody></table></div>
    <p>Subtotal: {money(order.subtotal)} · Discount: {money(order.discount)} · Shipping: {money(order.shipping)}{Number(order.cod_surcharge||0)>0&&<> · COD charge: {money(order.cod_surcharge||0)}</>}<br/>Payment: {order.payment_method==="bank_transfer"?"Advance bank transfer":"Cash on delivery"}{order.payment_status&&<> · {order.payment_status.replaceAll("_"," ")}</>}{order.payment_reference&&<> · Ref: {order.payment_reference}</>}{order.coupon_code && <> · Coupon: {order.coupon_code}</>}</p>
  </details>;
}
