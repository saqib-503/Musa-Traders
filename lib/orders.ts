export const ORDER_STATUSES = [
  "received",
  "confirmed",
  "packed",
  "handed_to_courier",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const orderStatusLabel: Record<string, string> = {
  pending: "Order received",
  received: "Order received",
  confirmed: "Confirmed",
  packed: "Packed",
  handed_to_courier: "Handed to courier",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function nextOrderStatus(status: string): OrderStatus | null {
  const flow: Record<string, OrderStatus | null> = {
    pending: "confirmed",
    received: "confirmed",
    confirmed: "packed",
    packed: "handed_to_courier",
    handed_to_courier: "out_for_delivery",
    out_for_delivery: "delivered",
    delivered: null,
    cancelled: null,
  };
  return flow[status] ?? null;
}
