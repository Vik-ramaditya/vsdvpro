-- Migration: Add pair grouping metadata to order_items for AC paired variants
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pair_group TEXT NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pair_role TEXT NULL CHECK (pair_role IN ('primary','secondary'));
CREATE INDEX IF NOT EXISTS idx_order_items_pair_group ON order_items(pair_group);
