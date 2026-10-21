-- Run once after the earlier Nestling migrations.
-- The icon is served by the Next.js app from /public/category-icons/ride-on-cars.svg.
insert into categories(name,slug,description,image_url,status,sort_order,show_in_menu,show_on_homepage)
values (
  'Ride-on Cars',
  'ride-on-cars',
  'Battery-powered ride-on cars, jeeps, bikes and accessories for children.',
  '/category-icons/ride-on-cars.svg',
  'active',0,true,true
)
on conflict(slug) do update set
  name=excluded.name,
  description=excluded.description,
  image_url=coalesce(categories.image_url,excluded.image_url),
  status='active',
  show_in_menu=true,
  show_on_homepage=true;
