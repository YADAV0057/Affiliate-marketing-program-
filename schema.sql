-- MoodManga Store schema
-- Prefixed with store_ to avoid collision with existing MoodManga tables in the same Supabase project.

create table if not exists store_products (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  price_inr numeric(10,2) not null,        -- price in rupees
  compare_at_price_inr numeric(10,2),      -- optional "was" price for showing a discount
  image_url text,
  gallery_urls text[] default '{}',
  mood_tag text,                            -- e.g. 'melancholic', 'euphoric' - ties into MoodManga branding
  category text not null default 'general', -- 'print' | 'general'
  stock_qty integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists store_orders (
  id uuid primary key default gen_random_uuid(),
   cashfree_order_id text unique,
  cashfree_payment_id text,
  status text not null default 'created', -- created | paid | failed | shipped | delivered | cancelled
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  shipping_address jsonb not null,
  subtotal_inr numeric(10,2) not null,
  shipping_inr numeric(10,2) not null default 0,
  total_inr numeric(10,2) not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  tracking_number text,
  tracking_carrier text,
  admin_notes text,
  coupon_code text,
  discount_inr numeric(10,2) not null default 0,
  -- ref code from the mst_aff_ref cookie (see js/track.js), set by
  -- create-order at checkout time. Validated/attributed on the affiliate
  -- service's side when verify-payment fires the conversion webhook.
  affiliate_ref text
);

create table if not exists store_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null,       -- 'percent' | 'flat'
  discount_value numeric(10,2) not null,
  min_order_inr numeric(10,2) not null default 0,
  max_uses integer,                  -- null = unlimited
  uses_count integer not null default 0,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists store_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references store_orders(id) on delete cascade,
  product_id uuid not null references store_products(id),
  product_name text not null,   -- snapshot at time of order
  unit_price_inr numeric(10,2) not null,
  quantity integer not null,
  line_total_inr numeric(10,2) not null
);

create index if not exists idx_store_products_active on store_products(is_active);
create index if not exists idx_store_orders_status on store_orders(status);

-- Row Level Security: products are publicly readable, orders are write-only from the client
-- (reads/updates happen via edge functions using the service role key)
alter table store_products enable row level security;
alter table store_orders enable row level security;
alter table store_order_items enable row level security;
alter table store_coupons enable row level security;

create policy "Public can read active products" on store_products
  for select using (is_active = true);

-- No public policies on store_orders / store_order_items:
-- all order creation & reads go through edge functions (service role), never direct from the browser.

-- Used by the verify-payment edge function after a successful payment
create or replace function decrement_stock(p_product_id uuid, p_qty integer)
returns void as $$
begin
  update store_products
  set stock_qty = greatest(stock_qty - p_qty, 0)
  where id = p_product_id;
end;
$$ language plpgsql security definer;

-- Seed a couple of example products so the storefront isn't empty on first deploy
insert into store_products (slug, name, description, price_inr, mood_tag, category, stock_qty, image_url)
values
  ('sample-print-01', 'Ronin Under Rain — A3 Art Print', 'Museum-grade matte print, 250gsm paper.', 899, 'melancholic', 'print', 50, null),
  ('sample-general-01', 'Wireless Earbuds Pro', 'General dropship item — 20hr battery, ANC.', 1499, null, 'general', 100, null)
on conflict (slug) do nothing;
