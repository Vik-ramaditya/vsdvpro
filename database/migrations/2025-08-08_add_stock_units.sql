-- Per-unit SKU support: create stock_units table
create table if not exists public.stock_units (
  id uuid primary key default uuid_generate_v4(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete cascade,
  unit_sku text not null unique,
  status text not null default 'available' check (status in ('available','reserved','sold','damaged')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (variant_id, warehouse_id, unit_sku)
);

-- trigger to update updated_at
create or replace function public.trigger_set_timestamp_stock_units()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_timestamp_stock_units
before update on public.stock_units
for each row execute function public.trigger_set_timestamp_stock_units();

-- indexes for performance
create index if not exists idx_stock_units_variant on public.stock_units(variant_id);
create index if not exists idx_stock_units_warehouse on public.stock_units(warehouse_id);
create index if not exists idx_stock_units_status on public.stock_units(status);

-- RLS
alter table public.stock_units enable row level security;
create policy "Allow authenticated users" on public.stock_units for all to authenticated using (true);
