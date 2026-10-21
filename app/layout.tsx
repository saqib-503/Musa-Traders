import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import { SITE, isSupabaseConfigured } from "@/lib/supabase";
import { jsonLd } from "@/lib/utils";
import Header from "@/components/Header";
import TopLoader from "@/components/TopLoader";
const themeBootstrap = "(function(){try{var saved=localStorage.getItem('nestling:theme');var theme=saved==='light'||saved==='dark'?saved:(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch(e){}})()";
export const metadata: Metadata = { metadataBase: new URL(SITE), title: { default: "Musa Traders", template: "%s | Musa Traders" }, robots: isSupabaseConfigured ? undefined : { index: false, follow: false }, description: "Quality kids products and ride-on cars from Musa Traders, Lahore.", openGraph: { siteName: "Musa Traders", type: "website" }, twitter: { card: "summary_large_image" } };
export default function Layout({ children }: { children: React.ReactNode }) {
  // Extensions may add root attributes before hydration. Descendant checks remain enabled.
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeBootstrap}}/></head><body suppressHydrationWarning>
    <Header/><TopLoader/><div className="shell page-content">{children}</div>
    <footer className="site-footer"><div className="shell footer-grid">
      <div><Link href="/" className="footer-brand">Musa Traders</Link><p>Kids products and ride-on cars from<br/>a trusted Lahore store.</p>
        {!isSupabaseConfigured && <p className="preview-label">Demo collection <span aria-hidden="true">·</span> Store setup in progress</p>}
      </div>
      <div><h3>Help</h3><Link href="/account">Your account</Link><Link href="/cart">Your cart</Link><Link href="/compare">Compare products</Link></div>
      <div><h3>Contact</h3><a href="tel:+923085892952">0308 5892952</a><a href="https://wa.me/923085892952" target="_blank" rel="noreferrer">WhatsApp us</a><p>Main Peco Road<br/>Kotlakh Pat Station, Lahore</p></div>
    </div></footer>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd({ "@context": "https://schema.org", "@type": "Organization", name: "Musa Traders", url: SITE, telephone: "+923085892952", address: { "@type": "PostalAddress", streetAddress: "Main Peco Road, Kotlakh Pat Station", addressLocality: "Lahore", addressCountry: "PK" } }) }}/>
  </body></html>;
}
