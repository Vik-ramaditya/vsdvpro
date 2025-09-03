import { DatabaseService } from '@/lib/database';

describe('Payment Entries', () => {
  let billId: string;

  beforeAll(async () => {
    // Create a test bill to work with
    const testBill = await DatabaseService.createBill({
      invoice_number: 'TEST-001',
      order_id: `order-${Date.now()}`,
      customer_id: null,
      bill_data: { items: [{ name: 'Test Item', quantity: 1, price: 100 }], customer: { name: 'Test Customer' } },
      subtotal: 100.00,
      tax_amount: 0,
      discount_amount: 0,
      total_amount: 100.00,
      payment_method: 'cash',
      status: 'active',
      created_by: 'test-user-id'
    });
    billId = testBill.id;
  });

  afterAll(async () => {
    // Clean up: delete the test bill
    await DatabaseService.deleteBill(billId);
  });

  test('should create a payment entry', async () => {
    const paymentEntry = await DatabaseService.createPaymentEntry({
      bill_id: billId,
      amount: 50.00,
      payment_method: 'cash',
      created_by: 'test-user-id'
    });

    expect(paymentEntry).toHaveProperty('id');
    expect(paymentEntry.amount).toBe(50.00);
  });

  test('should update the payment status of the bill', async () => {
    await DatabaseService.createPaymentEntry({
      bill_id: billId,
      amount: 50.00,
      payment_method: 'cash',
      created_by: 'test-user-id'
    });

    const updatedBill = await DatabaseService.getBillById(billId);
    expect(updatedBill).not.toBeNull();
    if (!updatedBill) throw new Error('Bill not found');
    expect(updatedBill.payment_status).toBe('paid');
    expect(updatedBill.remaining_amount).toBe(0);
  });

  test('should delete a payment entry and update the bill status', async () => {
    const paymentEntry = await DatabaseService.createPaymentEntry({
      bill_id: billId,
      amount: 30.00,
      payment_method: 'cash',
      created_by: 'test-user-id'
    });

    await DatabaseService.deletePaymentEntry(paymentEntry.id);

    const updatedBill = await DatabaseService.getBillById(billId);
    expect(updatedBill).not.toBeNull();
    if (!updatedBill) throw new Error('Bill not found');
    expect(updatedBill.payment_status).toBe('partial');
    expect(updatedBill.remaining_amount).toBe(30.00);
  });
});
