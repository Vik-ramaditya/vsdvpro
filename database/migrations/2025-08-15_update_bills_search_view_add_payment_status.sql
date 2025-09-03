-- Migration: Add payment_status & remaining_amount to bills_search_view
-- Run this after payment entries migration so columns exist on bills table.

-- Need to drop the existing view first because adding columns in the middle
-- (inserting payment_status & remaining_amount before notes) causes Postgres
-- to think we're renaming existing columns by position.
DROP VIEW IF EXISTS bills_search_view;

CREATE VIEW bills_search_view AS
SELECT 
    b.id,
    b.invoice_number,
    b.order_id,
    b.customer_id,
    b.bill_data,
    b.subtotal,
    b.tax_amount,
    b.discount_amount,
    b.total_amount,
    b.payment_method,
    b.payment_reference,
    b.status,
    b.payment_status,        -- newly added
    b.remaining_amount,      -- newly added
    b.notes,
    b.created_at,
    b.updated_at,
    b.created_by,
    -- Customer data
    c.name  AS customer_name,
    c.phone AS customer_phone,
    c.email AS customer_email,
    -- Order items for search
    array_agg(DISTINCT pv.sku)          AS product_skus,
    array_agg(DISTINCT p.name)          AS product_names,
    array_agg(DISTINCT pv.variant_name) AS variant_names,
    string_agg(DISTINCT p.name || ' ' || pv.variant_name || ' ' || pv.sku, ' ') AS searchable_text
FROM bills b
LEFT JOIN customers c      ON b.customer_id = c.id
LEFT JOIN order_items oi   ON b.order_id = oi.order_id
LEFT JOIN product_variants pv ON oi.variant_id = pv.id
LEFT JOIN products p       ON pv.product_id = p.id
GROUP BY 
    b.id, b.invoice_number, b.order_id, b.customer_id, b.bill_data,
    b.subtotal, b.tax_amount, b.discount_amount, b.total_amount,
    b.payment_method, b.payment_reference, b.status, b.payment_status, b.remaining_amount, b.notes,
    b.created_at, b.updated_at, b.created_by,
    c.name, c.phone, c.email;

-- Note: No data migration needed; view now exposes payment columns used by UI.
