-- Migration: Add supplier_variants join table to link suppliers with product variants
CREATE TABLE IF NOT EXISTS supplier_variants (
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (supplier_id, variant_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_supplier_variants_supplier ON supplier_variants(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_variants_variant ON supplier_variants(variant_id);

-- Enable RLS
ALTER TABLE supplier_variants ENABLE ROW LEVEL SECURITY;

-- Basic policy: allow authenticated users full access (adjust as needed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'supplier_variants' AND policyname = 'Allow authenticated users'
  ) THEN
    CREATE POLICY "Allow authenticated users" ON supplier_variants FOR ALL TO authenticated USING (true);
  END IF;
END$$;
