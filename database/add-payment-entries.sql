-- Payment Entries Table for tracking partial payments
CREATE TABLE IF NOT EXISTS payment_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
  payment_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reference_number VARCHAR(255),
  utr_number VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_payment_entries_bill_id ON payment_entries(bill_id);
CREATE INDEX IF NOT EXISTS idx_payment_entries_customer_id ON payment_entries(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_entries_payment_date ON payment_entries(payment_date);

-- Enable RLS
ALTER TABLE payment_entries ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "payment_entries_select_policy" ON payment_entries FOR SELECT USING (true);
CREATE POLICY "payment_entries_insert_policy" ON payment_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "payment_entries_update_policy" ON payment_entries FOR UPDATE USING (true);
CREATE POLICY "payment_entries_delete_policy" ON payment_entries FOR DELETE USING (true);

-- Update bills table to add payment tracking columns
DO $$ 
BEGIN
    -- Add payment_status column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bills' AND column_name = 'payment_status') THEN
        ALTER TABLE bills ADD COLUMN payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('paid', 'partial', 'pending'));
        -- Update existing bills to set payment_status to pending
        UPDATE bills SET payment_status = 'pending';
    END IF;
    
    -- Add remaining_amount column if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bills' AND column_name = 'remaining_amount') THEN
        ALTER TABLE bills ADD COLUMN remaining_amount DECIMAL(10,2);
        -- Update existing bills to set remaining_amount equal to total_amount
        UPDATE bills SET remaining_amount = total_amount;
    END IF;
END $$;

-- Function to update bill payment status based on payment entries
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
    
    -- Calculate total paid for this bill
    SELECT COALESCE(SUM(amount), 0) INTO total_paid
    FROM payment_entries 
    WHERE bill_id = COALESCE(NEW.bill_id, OLD.bill_id);
    
    remaining := bill_total - total_paid;
    
    -- Update bill payment status and remaining amount
    UPDATE bills 
    SET 
        remaining_amount = remaining,
        payment_status = CASE 
            WHEN remaining <= 0 THEN 'paid'
            WHEN total_paid > 0 THEN 'partial'
            ELSE 'pending'
        END
    WHERE id = COALESCE(NEW.bill_id, OLD.bill_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create triggers to automatically update bill payment status
DROP TRIGGER IF EXISTS payment_entry_update_bill_status ON payment_entries;
CREATE TRIGGER payment_entry_update_bill_status
    AFTER INSERT OR UPDATE OR DELETE ON payment_entries
    FOR EACH ROW
    EXECUTE FUNCTION update_bill_payment_status();
