import type { Product } from "./supabase";

export const demoCategories = [
  { name: "Clothing", slug: "clothing", art: "👕", tone: "blue" },
  { name: "Feeding", slug: "feeding", art: "🍼", tone: "gold" },
  { name: "Toys", slug: "toys", art: "🧸", tone: "rose" },
  { name: "Nursery", slug: "nursery", art: "🛏️", tone: "green" },
  { name: "Mother care", slug: "mother-care", art: "👩‍🍼", tone: "rose" },
  { name: "Bath & skin", slug: "bath-skin", art: "🛁", tone: "blue" },
];

const collection = [
  ["Organic cotton romper", "Little Moon", 2400, 1890, "clothing", "🩳", "blue", "New"],
  ["Anti-colic feeding bottle", "PureSip", 1250, null, "feeding", "🍼", "gold", "Best seller"],
  ["Soft plush bunny", "Cuddle Co", 1790, 1490, "toys", "🐰", "rose", ""],
  ["Foldable baby crib", "DreamNest", 36500, 32900, "nursery", "🛏️", "green", "Sale"],
  ["Maternity support pillow", "Mama Care", 4600, null, "mother-care", "🛋️", "rose", "New"],
  ["Tear-free baby wash", "Bubbly", 950, 780, "bath-skin", "🧴", "blue", ""],
  ["Muslin swaddle set of 3", "Little Moon", 2350, null, "clothing", "🧣", "gold", "Best seller"],
  ["Wooden stacking rings", "Cuddle Co", 1150, null, "toys", "🪀", "green", ""],
  ["Silicone bib with pocket", "PureSip", 890, 690, "feeding", "🥣", "gold", "Sale"],
  ["Sleep sack 6–12 months", "DreamNest", 2990, null, "nursery", "🌙", "blue", "New"],
  ["Nursing cover", "Mama Care", 1350, null, "mother-care", "🧡", "rose", ""],
  ["Baby bath tub with stand", "Bubbly", 6200, 5400, "bath-skin", "🛁", "green", "Sale"],
] as const;

// Reference-only collection. These rows are never inserted into the real database.
export const demoProducts: Product[] = collection.map(([name, brand, regular, sale, category, art, tone, badge], index) => ({
  id: `de000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  short_description: "A little everyday comfort, chosen with your growing family in mind.",
  description: "This product is part of the Nestling preview collection. Explore the design, save your favourites and try the cart. Real product details and ordering will be available when the store is connected.",
  regular_price: regular, sale_price: sale, brands: { name: brand }, product_images: [],
  product_variants: [{ id: `de100000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, color: null, size: null, stock: 20, price_override: null }],
  art, tone, badge, category,
}));
