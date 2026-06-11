import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { AggregatePaymentProvider } from '../aggregate-provider.js';

function makeProvider(secret?: string): AggregatePaymentProvider {
  return new AggregatePaymentProvider({
    merchantId: secret ? 'test_mch' : '',
    appId: secret ? 'test_app' : '',
    secret: secret ?? '',
    publicKey: '',
    privateKey: '',
    notifyUrl: 'https://example.com/notify',
    returnUrl: '',
  });
}

function sign(params: Record<string, string>, secret: string): string {
  const sortedKeys = Object.keys(params).filter((key) => params[key] !== '' && key !== 'sign').sort();
  const stringA = sortedKeys.map((key) => `${key}=${params[key]}`).join('&');
  return createHmac('sha256', secret).update(`${stringA}&key=${secret}`).digest('hex').toUpperCase();
}

describe('AggregatePaymentProvider', () => {
  describe('createPrepay', () => {
    it('should return provider order id and prepay params with sign', async () => {
      const provider = makeProvider('test_secret_123');
      const result = await provider.createPrepay({
        orderId: 'order-abc',
        userId: 'user-1',
        amountCents: 1000,
        description: 'Test package',
      });

      expect(result.providerOrderId).toBeDefined();
      expect(result.providerOrderId).toContain('order-abc');
      expect(result.prepayParams).toBeDefined();
      expect(result.prepayParams.timeStamp).toBeDefined();
      expect(result.prepayParams.nonceStr).toBeDefined();
      expect(result.prepayParams.paySign).toBeDefined();
      expect(result.prepayParams.signType).toBe('HMAC-SHA256');
      expect(result.prepayParams.appId).toBe('test_app');
      expect(result.prepayParams.merchantId).toBe('test_mch');
      expect(result.prepayParams.paySign?.length).toBe(64);
    });
  });

  describe('verifyNotify', () => {
    it('should throw on invalid signature when secret is set', async () => {
      const provider = makeProvider('test_secret_123');
      await expect(
        provider.verifyNotify({}, 'orderId=test&sign=invalid'),
      ).rejects.toThrow('Signature verification failed');
    });

    it('should pass verification with a valid signature', async () => {
      const secret = 'test_secret_123';
      const provider = makeProvider(secret);
      const params = {
        out_trade_no: 'order-test',
        result_code: 'SUCCESS',
        transaction_id: 'txn123',
        total_fee: '1000',
      };
      const rawBody = new URLSearchParams({ ...params, sign: sign(params, secret) }).toString();

      const result = await provider.verifyNotify(
        {},
        rawBody,
      );

      expect(result.providerTransactionId).toBe('txn123');
      expect(result.orderId).toBe('order-test');
      expect(result.amountCents).toBe(1000);
      expect(result.status).toBe('success');
    });

    it('should reject unsigned notify when aggregate config is incomplete', async () => {
      const provider = makeProvider();
      await expect(
        provider.verifyNotify(
          {},
          'out_trade_no=order-test&result_code=SUCCESS&transaction_id=txn123&total_fee=1000',
        ),
      ).rejects.toThrow('Aggregate payment provider is not configured');
    });

    it('should parse failed result correctly', async () => {
      const secret = 'test_secret_123';
      const provider = makeProvider(secret);
      const params = {
        out_trade_no: 'order-test',
        result_code: 'FAIL',
        transaction_id: 'txn456',
        total_fee: '500',
      };
      const rawBody = new URLSearchParams({ ...params, sign: sign(params, secret) }).toString();
      const result = await provider.verifyNotify(
        {},
        rawBody,
      );

      expect(result.status).toBe('failed');
      expect(result.orderId).toBe('order-test');
    });
  });

  describe('normalizeStatus', () => {
    it('should return the status from notify', () => {
      const provider = makeProvider();
      const notify = { providerTransactionId: 't1', orderId: 'o1', amountCents: 100, status: 'success' as const, paidAt: null };
      expect(provider.normalizeStatus(notify)).toBe('success');
    });

    it('should return failed status', () => {
      const provider = makeProvider();
      const notify = { providerTransactionId: 't1', orderId: 'o1', amountCents: 100, status: 'failed' as const, paidAt: null };
      expect(provider.normalizeStatus(notify)).toBe('failed');
    });
  });
});
