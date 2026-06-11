import { describe, it, expect, beforeEach } from 'vitest';
import type { PaymentProvider } from '../provider.interface.js';
import { MockPaymentProvider } from '../mock-provider.js';

describe('PaymentProvider contract', () => {
  function runContractTests(createProvider: () => PaymentProvider) {
    let provider: PaymentProvider;

    beforeEach(() => {
      provider = createProvider();
    });

    it('should create a prepay order and return provider order id and prepay params', async () => {
      const result = await provider.createPrepay({
        orderId: 'order-123',
        userId: 'user-123',
        amountCents: 1000,
        description: 'Test package',
      });

      expect(result.providerOrderId).toBeDefined();
      expect(typeof result.providerOrderId).toBe('string');
      expect(result.prepayParams).toBeDefined();
      expect(typeof result.prepayParams).toBe('object');
    });

    it('should verify a notify and return structured payment data', async () => {
      const result = await provider.verifyNotify({}, '');

      expect(result.providerTransactionId).toBeDefined();
      expect(result.status).toBeDefined();
      expect(['success', 'failed', 'cancelled']).toContain(result.status);
    });

    it('should normalize notify status to PaymentStatus', async () => {
      const notify = await provider.verifyNotify({}, '');
      const status = provider.normalizeStatus(notify);

      expect(['pending', 'success', 'failed', 'cancelled']).toContain(status);
    });
  }

  describe('MockPaymentProvider', () => {
    runContractTests(() => new MockPaymentProvider());
  });
});