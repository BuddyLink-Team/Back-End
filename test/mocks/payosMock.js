/**
 * Mock responses for PayOS payment gateway checkout and webhook.
 */
export const mockPayOSCheckout = {
  bin: '970407',
  accountNumber: '123456789',
  accountName: 'BUDDYLINK SERVICE',
  amount: 99000,
  description: 'Thanh toan goi Premium BuddyLink',
  orderCode: 123456,
  paymentLinkId: 'mock_pay_link_id',
  status: 'PENDING',
  checkoutUrl: 'https://pay.payos.vn/web/mock_checkout_url',
  qrCode: 'mock_qr_code_data',
};

export default { mockPayOSCheckout };
