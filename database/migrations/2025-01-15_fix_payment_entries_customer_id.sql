-- Fix payment_entries table to allow NULL customer_id for walk-in customers
-- This addresses the sync issue where walk-in customer payments fail due to NOT NULL constraint

-- Drop the existing NOT NULL constraint on customer_id
ALTER TABLE payment_entries ALTER COLUMN customer_id DROP NOT NULL;

-- Update the trigger function to handle NULL customer_id properly
CREATE OR REPLACE FUNCTION update_bill_payment_status()
RETURNS TRIGGER AS $$
DECLARE
    total_paid DECIMAL(10,2);
    bill_total DECIMAL(10,2);
    remaining DECIMAL(10,2);
BEGIN
    -- Get bill total
    SELECT total_amount INTO bill_total 
    FROM bills 
    WHERE id = COALESCE(NEW.bill_id, OLD.bill_id);
    
    -- If bill not found, log error and return
    IF bill_total IS NULL THEN
        RAISE WARNING 'Bill not found for payment entry: %', COALESCE(NEW.bill_id, OLD.bill_id);
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Calculate total paid for this bill
    SELECT COALESCE(SUM(amount), 0) INTO total_paid
    FROM payment_entries 
    WHERE bill_id = COALESCE(NEW.bill_id, OLD.bill_id);
    
    remaining := bill_total - total_paid;
    
    -- Ensure remaining amount is not negative (handle floating point precision)
    IF remaining < 0.01 THEN
        remaining := 0;
    END IF;
    
    -- Update bill payment status and remaining amount
    UPDATE bills 
    SET 
        remaining_amount = remaining,
        payment_status = CASE 
            WHEN remaining <= 0 THEN 'paid'
            WHEN total_paid > 0 THEN 'partial'
            ELSE 'pending'
        END,
        updated_at = NOW()
    WHERE id = COALESCE(NEW.bill_id, OLD.bill_id);
    
    -- Log the update for debugging
    RAISE NOTICE 'Updated bill % - Total: %, Paid: %, Remaining: %, Status: %', 
        COALESCE(NEW.bill_id, OLD.bill_id), 
        bill_total, 
        total_paid, 
        remaining,
        CASE 
            WHEN remaining <= 0 THEN 'paid'
            WHEN total_paid > 0 THEN 'partial'
            ELSE 'pending'
        END;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger to ensure it uses the updated function
DROP TRIGGER IF EXISTS payment_entry_update_bill_status ON payment_entries;
CREATE TRIGGER payment_entry_update_bill_status
    AFTER INSERT OR UPDATE OR DELETE ON payment_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_bill_payment_status();

-- Update existing payment_entries with NULL customer_id where bill has no customer
UPDATE payment_entries 
SET customer_id = NULL 
WHERE bill_id IN (
    SELECT id FROM bills WHERE customer_id IS NULL
) AND customer_id IS NOT NULL;

-- Add a check to ensure data consistency
DO $$
DECLARE
    inconsistent_count INTEGER;
BEGIN
    -- Check for bills with incorrect payment status
    SELECT COUNT(*) INTO inconsistent_count
    FROM bills b
    LEFT JOIN (
        SELECT 
            bill_id,
            SUM(amount) as total_paid
        FROM payment_entries 
        GROUP BY bill_id
    ) pe ON b.id = pe.bill_id
    WHERE 
        (COALESCE(pe.total_paid, 0) = 0 AND b.payment_status != 'pending') OR
        (COALESCE(pe.total_paid, 0) > 0 AND COALESCE(pe.total_paid, 0) < b.total_amount AND b.payment_status != 'partial') OR
        (COALESCE(pe.total_paid, 0) >= b.total_amount AND b.payment_status != 'paid');
    
    IF inconsistent_count > 0 THEN
        RAISE NOTICE 'Found % bills with inconsistent payment status. Running correction...', inconsistent_count;
        
        -- Fix inconsistent payment statuses
        UPDATE bills 
        SET 
            remaining_amount = GREATEST(0, total_amount - COALESCE(pe.total_paid, 0)),
            payment_status = CASE 
                WHEN COALESCE(pe.total_paid, 0) >= total_amount THEN 'paid'
                WHEN COALESCE(pe.total_paid, 0) > 0 THEN 'partial'
                ELSE 'pending'
            END,
            updated_at = NOW()
        FROM (
            SELECT 
                bill_id,
                SUM(amount) as total_paid
            FROM payment_entries 
            GROUP BY bill_id
        ) pe
        WHERE bills.id = pe.bill_id;
        
        -- Also update bills with no payments
        UPDATE bills 
        SET 
            remaining_amount = total_amount,
            payment_status = 'pending',
            updated_at = NOW()
        WHERE id NOT IN (SELECT DISTINCT bill_id FROM payment_entries)
        AND payment_status != 'pending';
        
        RAISE NOTICE 'Payment status correction completed.';
    ELSE
        RAISE NOTICE 'All bills have consistent payment status.';
    END IF;
END $$;
