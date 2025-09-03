-- Migration: Add stock_unit_pairs table for AC paired units (indoor + outdoor)
-- Date: 2025-08-14
-- Purpose: Represent a sellable AC unit composed of two physical component units (indoor & outdoor)

-- 1. Table definition (idempotent safeguards)
CREATE TABLE IF NOT EXISTS public.stock_unit_pairs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  combined_sku text NOT NULL UNIQUE,
  indoor_unit_id uuid NOT NULL REFERENCES public.stock_units(id) ON DELETE CASCADE,
  outdoor_unit_id uuid NOT NULL REFERENCES public.stock_units(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','sold','damaged')),
  reservation_id uuid NULL,
  reservation_expires_at timestamptz NULL,
  bill_id uuid NULL REFERENCES public.bills(id) ON DELETE SET NULL,
  order_id uuid NULL REFERENCES public.orders(id) ON DELETE SET NULL,
  sold_to_customer_id uuid NULL REFERENCES public.customers(id) ON DELETE SET NULL,
  sold_date timestamptz NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(indoor_unit_id),
  UNIQUE(outdoor_unit_id)
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_stock_unit_pairs_status ON public.stock_unit_pairs(status);
CREATE INDEX IF NOT EXISTS idx_stock_unit_pairs_reservation ON public.stock_unit_pairs(reservation_id);
CREATE INDEX IF NOT EXISTS idx_stock_unit_pairs_bill ON public.stock_unit_pairs(bill_id);
CREATE INDEX IF NOT EXISTS idx_stock_unit_pairs_order ON public.stock_unit_pairs(order_id);
CREATE INDEX IF NOT EXISTS idx_stock_unit_pairs_sold_date ON public.stock_unit_pairs(sold_date);

-- 3. Trigger function for timestamps & sold_date stamping
CREATE OR REPLACE FUNCTION public.trigger_set_timestamp_stock_unit_pairs()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status = 'sold' AND (OLD.status IS DISTINCT FROM 'sold') THEN
    NEW.sold_date = now();
  END IF;
  IF NEW.status != 'sold' AND OLD.status = 'sold' THEN
    NEW.sold_date = NULL; -- allow reversion if manually corrected
  END IF;
  RETURN NEW;
END;$$ LANGUAGE plpgsql;

CREATE TRIGGER set_timestamp_stock_unit_pairs
BEFORE UPDATE ON public.stock_unit_pairs
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp_stock_unit_pairs();

-- 4. RLS
ALTER TABLE public.stock_unit_pairs ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY does not support IF NOT EXISTS in current PostgreSQL versions.
-- Use DO block to conditionally create the policy if it is absent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stock_unit_pairs'
      AND policyname = 'Allow authenticated users'
  ) THEN
    CREATE POLICY "Allow authenticated users" ON public.stock_unit_pairs FOR ALL TO authenticated USING (true);
  END IF;
END$$;

-- 5. Comments
COMMENT ON TABLE public.stock_unit_pairs IS 'Logical pairing of two stock_units (indoor/outdoor) sold as one AC set.';
COMMENT ON COLUMN public.stock_unit_pairs.combined_sku IS 'Scanable SKU representing the complete AC set (indoor + outdoor).';
COMMENT ON COLUMN public.stock_unit_pairs.status IS 'Set status; component stock_units mirror this status.';

-- 6. Helper notification (optional schema reload for PostgREST)
NOTIFY pgrst, 'reload schema';
