# Admin functionality

Functionality reference: `C:/Users/SAQIB/Music/E Commerce Store/app/admin` and its `components/admin-*-manager.tsx` files. Nestling keeps its existing colors, typography and storefront layout.

| Reference area | Nestling implementation |
| --- | --- |
| Dashboard | Database totals for users, products, orders, delivered order value, open order value, average delivered order, low-stock variants |
| Products | Atomic add/edit, active/draft, regular/sale price, brand, product/variant SKU, tags, multiple categories, related products, featured/new/bestseller flags, sizes/colors, stock and price override |
| Images | Up to 12 uploads per product, previews, alt text, remove from gallery, select cover; each file at most 5 MB |
| Categories | Add/edit/delete, description, direct image upload with preview, display order, active/draft, menu and homepage visibility |
| Orders | Customer/address/item details, search/status filter, status changes, automatic cancellation stock restoration and in-app customer updates |
| Users | Searchable, paginated directory with name, email, phone, join date and role; admin-only role changes; no self-demotion |
| Reviews | Customer submission after delivery; pending/approved filters, approve/unpublish/delete, pagination; approved reviews appear on product pages |
| Discounts | Percentage or fixed PKR discount, description, activation, start/expiry dates, usage limit, add/edit/delete |
| Analytics | Period selection, delivered sales by day in Pakistan time, status totals, top selling products and catalog coverage |

Brands remain a separate Nestling section. `/admin/discounts` and `/admin/coupons` both open the discount manager.

The storefront header always shows **Login**, linking to `/login`. Login and account creation have separate pages (`/login` and `/signup`); signup includes password confirmation and an email-verification screen. Admin sign-in opens `/admin`, with **Add product** and **Manage orders** shortcuts above the totals; customer sign-in opens `/account`. Visiting `/account` as an admin also opens the dashboard; the admin navigation's **My account** link uses `/account?view=profile` for personal details and purchases.

## Apply to the existing store

Run **only** `supabase/migrations/20261002_admin_features.sql` once in the connected project's SQL Editor, after the previous backend setup. This migration keeps existing accounts, products and orders. Do not run `setup.sql` on an existing database. Run `npm run backend:check` and refresh `/admin` afterward. The admin editor waits for this schema version so that an older backend cannot silently discard the new product fields.

The development environment has a public Supabase key, which cannot execute database migrations. The local regression suite executes both a fresh setup and the upgrade on temporary PostgreSQL-compatible databases; it does not apply the migration to the hosted database.

## Behavioral details

- COD **delivered order value** is not a payment reconciliation report. Pending/confirmed/shipped totals are separate; cancelled orders are excluded from delivered sales and averages. Top product sales show line totals before order discounts and shipping.
- Coupon checks and stock updates occur in the checkout transaction. Coupon row locks enforce usage limits across concurrent orders; identical checkout retries return the original order. Accepted orders keep their usage even when later cancelled. Fixed discounts cannot exceed merchandise subtotal.
- Products with order history cannot be deleted; use Draft to stop sales while preserving cancellations and history. Existing variants remain; set stock to zero to stop a variant. Only unsaved variants can be removed in the editor.
- Role changes use a guarded database function. Customer profile updates never receive permission to write `role`. User email is read from `auth.users` only inside the guarded admin directory function.
- Reviews are limited to one per customer/product and require a delivered purchase. Ratings shown in customer reviews come from actual submissions; there is no fabricated rating/count input.
- Order notifications are stored in the database transaction and displayed under `/account`. This does not send transactional email or SMS. No email worker, payment gateway or courier integration is added.
- Removed images leave the gallery when the product is saved. Storage files are retained; interrupted saves may leave unused uploads. Retrying unchanged form data on the same page reuses completed uploads.
- Category images upload to the existing `media` bucket under `categories/`; the public URL is stored in `categories.image_url` and displayed on homepage category tiles. Uploads accept JPG, PNG, WebP, GIF and AVIF up to 5 MB. Existing images can be kept, replaced or removed; completed uploads are reused if the category save fails. Removing an image clears its category link without deleting the storage file. No additional SQL migration is required.
- User and review lists are paginated. Product/category/order editors currently load one Supabase result page; large catalogs require server pagination before exceeding the project's row-return limit.
- This update does not copy the reference's theme, authentication implementation or database credentials.

## Live acceptance check after the migration

1. Sign in with the admin account. Confirm all admin sections load.
2. Add an active product with stock, two images, a category and SKU; view its product page and cover image.
3. Create a small test discount with an expiry and usage limit. Place a COD order with a customer account.
4. Confirm totals and stock, move the order to delivered, then submit a review from that customer. Approve it and confirm public visibility.
5. Use a separate test order for cancellation, confirming stock returns once and the customer receives an in-app status update.
6. Compare analytics against these orders. Role changes and deletion controls should be exercised only on designated test accounts/products.
