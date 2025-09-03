-- Reservation support for soft holds in carts
alter table if exists public.stock_units
  add column if not exists reservation_id uuid null,
  add column if not exists reservation_expires_at timestamptz null;

create index if not exists idx_stock_units_reservation on public.stock_units(reservation_id);
create index if not exists idx_stock_units_status_variant_wh on public.stock_units(status, variant_id, warehouse_id);

comment on column public.stock_units.reservation_id is 'Cart/session id that reserved the unit';
comment on column public.stock_units.reservation_expires_at is 'Expiry timestamp for reservation; expired reservations are reclaimable.';

-- Optional helper view for availability metrics
create or replace view public.variant_warehouse_availability as
select
  variant_id,
  warehouse_id,
  count(*) filter (where status in ('available','reserved')) as on_hand,
  count(*) filter (where status='reserved' and (reservation_expires_at is null or reservation_expires_at > now())) as in_carts,
  count(*) filter (where status='available') as available
from public.stock_units
group by variant_id, warehouse_id;
