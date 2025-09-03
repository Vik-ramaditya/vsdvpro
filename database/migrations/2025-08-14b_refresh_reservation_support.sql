-- Migration: Refresh / ensure reservation support on stock_units (idempotent)
-- Date: 2025-08-14 (b)
-- Purpose: In case earlier reservation migration wasn't applied, this safely (re)adds columns,
--          indexes, view, comments, then triggers PostgREST schema reload.

-- 1. Add columns if missing
ALTER TABLE public.stock_units
  ADD COLUMN IF NOT EXISTS reservation_id uuid NULL,
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz NULL;

-- 2. Indexes (safe / idempotent)
CREATE INDEX IF NOT EXISTS idx_stock_units_reservation ON public.stock_units(reservation_id);
CREATE INDEX IF NOT EXISTS idx_stock_units_status_variant_wh ON public.stock_units(status, variant_id, warehouse_id);

-- 3. Availability view (recreate to ensure alignment)
CREATE OR REPLACE VIEW public.variant_warehouse_availability AS
SELECT
  variant_id,
  warehouse_id,
  COUNT(*) FILTER (WHERE status IN ('available','reserved')) AS on_hand,
  COUNT(*) FILTER (
    WHERE status='reserved'
      AND (
        reservation_expires_at IS NULL
        OR reservation_expires_at > now()
      )
  ) AS in_carts,
  COUNT(*) FILTER (WHERE status='available') AS available
FROM public.stock_units
GROUP BY variant_id, warehouse_id;

COMMENT ON COLUMN public.stock_units.reservation_id IS 'Cart/session id that reserved the unit';
COMMENT ON COLUMN public.stock_units.reservation_expires_at IS 'Expiry timestamp for reservation; expired reservations are reclaimable.';
COMMENT ON VIEW public.variant_warehouse_availability IS 'Real-time unit availability metrics (on_hand, in_carts, available).';

-- 4. Trigger PostgREST schema cache reload (harmless if run outside PostgREST context)
NOTIFY pgrst, 'reload schema';

-- 5. Verification helper (ignored by migration runner; manual execution only)
-- SELECT id, reservation_id, reservation_expires_at FROM public.stock_units LIMIT 1;
