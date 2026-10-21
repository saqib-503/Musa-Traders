export type CartLine = { variant_id: string; name: string; price: number; qty: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let owner: string | null = null;
let accountData: Record<string, unknown> = {};
let revision = 0;
let versions: Record<string, number> = {};
function changed() { if (typeof window !== "undefined") window.dispatchEvent(new Event("nestling:storage")); }
export function clearAccountStorage() { revision++; owner = null; accountData = {}; versions = {}; changed(); }
export async function loadAccountStorage(redirect = false): Promise<boolean> {
  const { sb, isSupabaseConfigured } = await import("./supabase");
  const login = () => { if (redirect) window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); };
  if (!isSupabaseConfigured) { clearAccountStorage(); login(); return false; }
  const { data: { user }, error } = await sb.auth.getUser();
  if (!user) { clearAccountStorage(); login(); return false; }
  if (error) throw error;
  if (owner !== user.id) clearAccountStorage();
  const version = revision;
  const result = await sb.from("customer_saved_items").select("kind,payload,version").eq("user_id", user.id);
  if (result.error) throw new Error("Could not load your saved items. Please try again.");
  if (version !== revision) return false;
  owner = user.id; accountData = {};
  for (const row of result.data || []) { accountData[row.kind] = row.payload; versions[row.kind] = row.version; }
  changed(); return true;
}
async function persist(kind: string, payload: unknown) {
  const { sb } = await import("./supabase");
  const { data: { user }, error } = await sb.auth.getUser();
  if (error || !user || user.id !== owner) { clearAccountStorage(); throw new Error("Please sign in before saving items."); }
  const version = revision;
  const result = await sb.rpc("save_customer_items", {p_kind:kind, p_payload:payload, p_expected_version:versions[kind] || 0});
  if (result.error) throw new Error("Your items could not be saved. Refresh the page and try again.");
  if (version === revision && owner === user.id) { revision++; accountData[kind] = payload; versions[kind] = Number(result.data); changed(); }
}
function read(key: string): unknown {
  if (key === "cart" || key === "nestling:favourites") return owner ? accountData[key === "cart" ? "cart" : "wishlist"] : null;
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}
export const cart = {
  get(): CartLine[] {
    const value = read("cart");
    if (!Array.isArray(value)) return [];
    const lines = new Map<string, CartLine>();
    for (const line of value) {
      if (!line || typeof line.variant_id !== "string" || !uuid.test(line.variant_id)
        || typeof line.name !== "string" || !Number.isFinite(line.price) || line.price < 0
        || !Number.isInteger(line.qty) || line.qty < 1) continue;
      const old = lines.get(line.variant_id);
      lines.set(line.variant_id, { variant_id: line.variant_id, name: line.name,
        price: line.price, qty: Math.min(20, (old?.qty || 0) + line.qty) });
    }
    return [...lines.values()].slice(0, 100);
  },
  async set(lines: CartLine[]) { await persist("cart", lines); },
};
// A versioned key discards legacy name-based comparisons safely.
export const compare = {
  get(): string[] {
    const value = read("compare:v2");
    return Array.isArray(value)
      ? [...new Set(value.filter((id): id is string => typeof id === "string" && uuid.test(id)))].slice(-4) : [];
  },
  add(id: string) {
    if (!uuid.test(id)) throw new Error("Invalid product ID");
    localStorage.setItem("compare:v2", JSON.stringify([...new Set([...compare.get(), id])].slice(-4)));
  },
};
export function checkoutRequest(userId: string, payload: unknown): string {
  const fingerprint = JSON.stringify({ userId, payload });
  const previous = read("checkout:request") as { fingerprint?: string; id?: string } | null;
  if (previous?.fingerprint === fingerprint && typeof previous.id === "string" && uuid.test(previous.id)) return previous.id;
  const id = crypto.randomUUID();
  // Persist before sending, so a reload after a lost response can retry safely.
  localStorage.setItem("checkout:request", JSON.stringify({ fingerprint, id }));
  return id;
}

export const favourites = {
  get(): string[] {
    const value = read("nestling:favourites");
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && uuid.test(id)))] : [];
  },
  async toggle(id: string) {
    const current = favourites.get();
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
    await persist("wishlist", next);
    return next;
  },
};
