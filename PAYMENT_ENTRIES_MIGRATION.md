# Payment Entries Migration

## Overview
This migration adds payment entry tracking functionality to support partial payments for bills.

## What's Added
1. **payment_entries table** - Tracks individual payment entries for bills
2. **payment_status column** in bills table - Tracks if bill is 'paid', 'partial', or 'pending'
3. **remaining_amount column** in bills table - Tracks remaining amount to be paid
4. **Auto-update trigger** - Automatically updates bill payment status when payments are added/modified

## How to Run
1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy the entire contents of `database/add-payment-entries.sql`
4. Paste and run the SQL

## Features Enabled
- Track partial payments for bills
- View payment history for each bill
- Automatic calculation of remaining amounts
- Payment status updates (pending → partial → paid)
- Payment entry management (add, edit, delete)

## UI Access
After running the migration, you can access payment management at:
`/bills/[bill-id]/payments`

The bills page now shows:
- Payment Status column
- Remaining Amount column
- "Manage Payments" button for each bill
