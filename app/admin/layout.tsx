import Link from "next/link";
import AdminSetupStatus from "@/components/AdminSetupStatus";
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-shell"><nav className="admin-nav" aria-label="Admin navigation">{[['Overview','/admin'],['Notifications','/admin/notifications'],['Products','/admin/products'],['Categories','/admin/categories'],['Brands','/admin/brands'],['Discounts','/admin/coupons'],['Payments','/admin/payments'],['Orders','/admin/orders'],['Users','/admin/users'],['Reviews','/admin/reviews'],['Analytics','/admin/analytics'],['My account','/account?view=profile']].map(([name,href]) => <Link key={href} href={href}>{name}</Link>)}</nav><AdminSetupStatus>{children}</AdminSetupStatus></div>;
}
