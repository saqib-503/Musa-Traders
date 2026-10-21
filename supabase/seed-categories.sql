-- Optional starter categories only. No demo stock, accounts, or orders are created.
insert into categories(name,slug,sort_order) values
  ('Clothing','clothing',1),('Feeding','feeding',2),('Toys','toys',3),
  ('Nursery','nursery',4),('Mother care','mother-care',5),('Bath & skin','bath-skin',6)
on conflict(slug) do nothing;
