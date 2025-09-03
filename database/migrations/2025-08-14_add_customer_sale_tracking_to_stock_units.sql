-- Migration: Add customer sale tracking to stock_units and unit-based stock views
-- Date: 2025-08-14
-- This migration adds sold_to_customer_id & sold_date, and creates views to support
-- unit-based stock aggregation (variants & products) replacing quantity reliance on stock table.

-- 1. New columns for customer linkage & sold timestamp (idempotent)
ALTER TABLE public.stock_units
  ADD COLUMN IF NOT EXISTS sold_to_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

-- Some earlier migrations added sale_date; we standardize on sold_date for API while retaining sale_date for backward compatibility
ALTER TABLE public.stock_units
  ADD COLUMN IF NOT EXISTS sold_date timestamptz;

-- Backfill sold_date from existing sale_date if present and sold_date is null
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'stock_units' AND column_name = 'sale_date'
  ) THEN
    EXECUTE 'UPDATE public.stock_units SET sold_date = sale_date WHERE sold_date IS NULL AND sale_date IS NOT NULL';
  END IF;
END$$;

-- 2. Replace/update trigger function to maintain both sale_date (legacy) and sold_date (new)
CREATE OR REPLACE FUNCTION public.update_stock_unit_sale_date()
RETURNS TRIGGER AS $$
BEGIN
  -- If status transitions to sold, stamp sold_date (& legacy sale_date if column exists)
  IF NEW.status = 'sold' AND OLD.status != 'sold' THEN
    NEW.sold_date = NOW();
    -- Maintain legacy column if present
    BEGIN
      PERFORM 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_units' AND column_name='sale_date';
      IF FOUND THEN
        NEW.sale_date = NEW.sold_date;
      END IF;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;

  -- If reverting from sold, clear new & legacy dates
  IF NEW.status != 'sold' AND OLD.status = 'sold' THEN
    NEW.sold_date = NULL;
    BEGIN
      PERFORM 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_units' AND column_name='sale_date';
      IF FOUND THEN
        NEW.sale_date = NULL;
      END IF;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Indexes for faster lookup
CREATE INDEX IF NOT EXISTS idx_stock_units_sold_to_customer ON public.stock_units(sold_to_customer_id);
CREATE INDEX IF NOT EXISTS idx_stock_units_sold_date ON public.stock_units(sold_date);

-- 4. Unit-based variant stock totals view (counts available units)
DROP VIEW IF EXISTS public.variant_stock_totals;
CREATE VIEW public.variant_stock_totals AS
SELECT
  su.variant_id,
  COUNT(*)::int AS total_quantity
FROM public.stock_units su
WHERE su.status = 'available'
GROUP BY su.variant_id;
COMMENT ON VIEW public.variant_stock_totals IS 'Aggregated available unit counts per variant (unit-based stock).';

-- 5. Product-level stock totals view (sum of variant available units)
DROP VIEW IF EXISTS public.product_stock_totals;
CREATE VIEW public.product_stock_totals AS
SELECT
  p.id AS product_id,
  COALESCE(SUM(vst.total_quantity),0)::int AS total_quantity
FROM public.products p
LEFT JOIN public.product_variants pv ON pv.product_id = p.id
LEFT JOIN public.variant_stock_totals vst ON vst.variant_id = pv.id
GROUP BY p.id;
COMMENT ON VIEW public.product_stock_totals IS 'Aggregated available unit counts per product via variants.';

-- 6. Convenience view for sold unit history joined to customers & variants
DROP VIEW IF EXISTS public.sold_stock_unit_history;
CREATE VIEW public.sold_stock_unit_history AS
SELECT
  su.id,
  su.unit_sku AS serial_number,
  su.variant_id,
  pv.sku AS variant_sku,
  pv.variant_name,
  pv.product_id,
  p.name AS product_name,
  su.warehouse_id,
  su.sold_to_customer_id,
  c.name AS customer_name,
  su.bill_id,
  su.order_id,
  su.sold_date,
  COALESCE(su.sold_date, su.sale_date) AS effective_sold_date
FROM public.stock_units su
JOIN public.product_variants pv ON pv.id = su.variant_id
JOIN public.products p ON p.id = pv.product_id
LEFT JOIN public.customers c ON c.id = su.sold_to_customer_id
WHERE su.status = 'sold';
COMMENT ON VIEW public.sold_stock_unit_history IS 'History of sold stock units including customer and product/variant context.';

-- 7. RLS (inherit from underlying tables; no separate policies needed for simple views)

-- End migration.
