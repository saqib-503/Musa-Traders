"use client";
import { useEffect, useMemo, useState } from "react";
import type { Product } from "@/lib/supabase";
import Card from "./Card";
export default function ProductGrid({ products, title = "All products" }: { products: Product[]; title?: string }) {
  const [sort, setSort] = useState("featured");
  const [page, setPage] = useState(1);
  const perPage = 12;
  const visible = useMemo(() => {
    const sorted = [...products];
    if (sort === "low") sorted.sort((a, b) => (a.sale_price ?? a.regular_price) - (b.sale_price ?? b.regular_price));
    if (sort === "high") sorted.sort((a, b) => (b.sale_price ?? b.regular_price) - (a.sale_price ?? a.regular_price));
    return sorted;
  }, [products, sort]);
  const totalPages = Math.max(1, Math.ceil(visible.length / perPage));
  const currentPage = Math.min(page, totalPages);
  const pageProducts = visible.slice((currentPage - 1) * perPage, currentPage * perPage);
  useEffect(() => setPage(1), [products, sort]);
  function changePage(next: number) {
    setPage(next);
    document.getElementById("products")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  return <section className="products-section" id="products" aria-labelledby="products-heading"><h2 id="products-heading">{title}</h2>
    <div className="catalog-toolbar"><p>{products.length} {products.length === 1 ? "product" : "products"}{visible.length > perPage ? ` · Showing ${(currentPage - 1) * perPage + 1}–${Math.min(currentPage * perPage, visible.length)}` : ""}</p><select aria-label="Sort products" value={sort} onChange={event => setSort(event.target.value)}>
      <option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option>
    </select></div>
    {visible.length ? <><div className="product-grid">{pageProducts.map(product => <Card key={product.id} p={product}/>)}</div>{totalPages > 1 && <nav className="catalog-pagination" aria-label="Product pages"><button type="button" className="btn btn-secondary" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>Previous</button><span aria-live="polite">Page {currentPage} of {totalPages}</span><button type="button" className="btn" disabled={currentPage === totalPages} onClick={() => changePage(currentPage + 1)}>Next</button></nav>}</> : <div className="empty-state"><h3>No products found</h3><p>Try a different search or browse another category.</p></div>}
  </section>;
}
