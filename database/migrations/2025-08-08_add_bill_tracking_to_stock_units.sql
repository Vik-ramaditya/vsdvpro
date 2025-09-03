-- Add bill tracking to stock units
-- This migration adds the ability to track which bill a stock unit was sold in

-- Add bill_id column to stock_units table to track which bill the unit was sold in
ALTER TABLE public.stock_units 
ADD COLUMN bill_id UUID REFERENCES public.bills(id) ON DELETE SET NULL;

-- Add order_id column as well since bills reference orders
ALTER TABLE public.stock_units 
ADD COLUMN order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_stock_units_bill_id ON public.stock_units(bill_id);
CREATE INDEX IF NOT EXISTS idx_stock_units_order_id ON public.stock_units(order_id);

-- Add sale_date column to track when the unit was sold
ALTER TABLE public.stock_units 
ADD COLUMN sale_date TIMESTAMPTZ NULL;

-- Create an index for sale_date
CREATE INDEX IF NOT EXISTS idx_stock_units_sale_date ON public.stock_units(sale_date);

-- Update the trigger function to set sale_date when status changes to 'sold'
CREATE OR REPLACE FUNCTION public.update_stock_unit_sale_date()
RETURNS TRIGGER AS $$
BEGIN
  -- If status is being changed to 'sold', set sale_date
  IF NEW.status = 'sold' AND OLD.status != 'sold' THEN
    NEW.sale_date = NOW();
  END IF;
  
  -- If status is being changed from 'sold' to something else, clear sale_date
  IF NEW.status != 'sold' AND OLD.status = 'sold' THEN
    NEW.sale_date = NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic sale_date updates
CREATE TRIGGER trigger_update_stock_unit_sale_date
    BEFORE UPDATE ON public.stock_units
    FOR EACH ROW
    EXECUTE FUNCTION public.update_stock_unit_sale_date();
    