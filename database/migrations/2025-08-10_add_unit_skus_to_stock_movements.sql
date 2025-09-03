-- Add unit-level SKU references to stock_movements for traceability
alter table if exists public.stock_movements
  add column if not exists unit_skus text[] null;

comment on column public.stock_movements.unit_skus is 'List of per-unit SKUs associated with this movement line (optional)';
