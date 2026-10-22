import Link from "next/link";
import { sb, CARD_COLS, type Product, isSupabaseConfigured } from "@/lib/supabase";
import { demoProducts, demoCategories } from "@/lib/demo";
import ProductGrid from "@/components/ProductGrid";
import Card from "@/components/Card";
import Newsletter from "@/components/Newsletter";
import HeroArt from "@/components/HeroArt";

export const dynamic = "force-dynamic";
async function loadStorefront() {
  const [categoryResult, productResult] = await Promise.all([
    sb.from("categories").select("id,parent_id,name,slug,image_url,description").eq("status", "active").eq("show_in_menu", true).order("sort_order"),
    sb.from("products").select(`${CARD_COLS},product_categories(category_id)`).eq("status", "active").order("created_at", { ascending: false }).limit(48),
  ]);
  if (categoryResult.error) throw categoryResult.error;
  if (productResult.error) throw productResult.error;
  return { categories: categoryResult.data || [], products: productResult.data || [] };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string | string[]; offers?: string }> }) {
  const params = await searchParams;
  const query = (Array.isArray(params.q) ? params.q[0] : params.q || "").trim();
  let categories: { id?:string; parent_id?:string|null; name:string; slug:string; art?:string; tone?:string; image_url?:string; description?:string|null }[] = demoCategories;
  let products: Product[] = demoProducts;
  if (isSupabaseConfigured) {
    const storefront = await loadStorefront();
    categories = storefront.categories.map(category => ({ ...demoCategories.find(demo => demo.slug === category.slug), ...category }));
    products = storefront.products as unknown as Product[];
  }
  const visible = products.filter(product => (!query || `${product.name} ${product.brands?.name || ""}`.toLowerCase().includes(query.toLowerCase())) && (params.offers !== "1" || product.sale_price !== null));
  const menuCategories = categories.filter(category => !category.parent_id).slice(0, 5).map(category => ({ ...category, children: categories.filter(child => child.parent_id === category.id) }));
  const rideOnCategory = categories.find(category => category.slug === "ride-on-cars");
  const carProducts = products.filter((product:any) => rideOnCategory ? product.product_categories?.some((link:{category_id:string}) => link.category_id === rideOnCategory.id) || (!isSupabaseConfigured && product.category === "ride-on-cars") : true);
  const showcaseProducts = (carProducts.length ? carProducts : products).slice(0, 4);
  const newArrivals = products.filter(product => product.new_arrival).slice(0, 4);
  const bestSellers = products.filter(product => product.best_seller).slice(0, 4);
  const shelves = [
    { title:"Featured ride-on cars", description:"Popular electric cars ready for little drivers.", products:showcaseProducts },
    ...(newArrivals.length >= 2 ? [{ title:"New arrivals", description:"Fresh rides and the latest features.", products:newArrivals }] : []),
    ...(bestSellers.length >= 2 ? [{ title:"Best sellers", description:"Customer favourites for everyday adventures.", products:bestSellers }] : [])
  ].filter(shelf => shelf.products.length);

  return <main className="storefront car-storefront">
    {menuCategories.length > 0 && <nav className="car-store-nav" aria-label="Product categories">{menuCategories.map(category => <div className="car-store-nav-item" key={category.slug}><Link href={`/category/${category.slug}`}>{category.name}{category.children.length > 0 && <span className="category-arrow" aria-hidden="true">⌄</span>}</Link>{category.children.length > 0 && <div className="car-store-dropdown">{category.children.map(child => <Link key={child.slug} href={`/category/${child.slug}`}>{child.name}</Link>)}</div>}</div>)}</nav>}
    <section className="hero car-hero"><div className="hero-copy"><p className="hero-kicker">Musa Traders ride-on collection</p><h1>Big adventures<br className="hero-break"/> start with<br className="hero-break"/> little wheels.</h1><p>Battery-powered ride-on cars, jeeps and bikes for unforgettable playtime across Pakistan.</p><div className="hero-buttons"><Link className="btn" href="/category/ride-on-cars">Shop ride-on cars</Link><Link className="btn btn-secondary" href="#products">Explore collection</Link></div></div><HeroArt/></section>
    <section className="benefits car-benefits" aria-label="Shopping benefits"><div><strong>Free delivery</strong><span>On orders above Rs. 5,000</span></div><div><strong>Cash on delivery</strong><span>Pay when it arrives</span></div><div><strong>Manual bank transfer</strong><span>Easy advance payment</span></div><div><strong>Trusted Lahore store</strong><span>Support via WhatsApp</span></div></section>
    <section className="vehicle-types" aria-labelledby="vehicle-types-heading"><div className="section-heading"><div><p className="hero-kicker">Find the perfect ride</p><h2 id="vehicle-types-heading">Shop by vehicle type</h2></div><Link href="/category/ride-on-cars">View all cars &rarr;</Link></div><div className="vehicle-type-grid"><Link className="vehicle-type-card suv" href="/category/ride-on-cars"><img src="/hero-cars/ride-on-suv.webp" alt="White ride-on SUV"/><span><strong>SUVs and Jeeps</strong><small>Ready for every adventure</small></span></Link><Link className="vehicle-type-card sports" href="/category/ride-on-cars"><img src="/hero-cars/ride-on-sports-car.webp" alt="Red ride-on sports car"/><span><strong>Sports Cars</strong><small>Big style for little drivers</small></span></Link><Link className="vehicle-type-card jeep" href="/category/ride-on-cars"><img src="/hero-cars/ride-on-jeep.webp" alt="Blue ride-on jeep"/><span><strong>Off-road Rides</strong><small>Built for playtime fun</small></span></Link></div></section>
    <section className="car-shelves" aria-label="Featured ride-on car collections">{shelves.map(shelf=><section className="car-shelf" key={shelf.title}><div className="section-heading"><div><h2>{shelf.title}</h2><p>{shelf.description}</p></div><Link href="/category/ride-on-cars">View all &rarr;</Link></div><div className="collection-products">{shelf.products.map(product=><Card key={product.id} p={product}/>)}</div></section>)}</section>
    <ProductGrid key={`${query}-${params.offers}`} products={visible} title={query ? `Results for “${query}”` : params.offers === "1" ? "Special offers" : "Browse all ride-on cars"}/>
    {(query || params.offers === "1") && <Link className="clear-filters" href="/#products">View all products</Link>}
    <Newsletter/>
  </main>;
}
