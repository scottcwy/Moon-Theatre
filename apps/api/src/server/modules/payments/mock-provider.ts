import type { PaymentProvider } from './provider.interface.js';
import type { CreatePrepayInput, CreatePrepayResult, VerifiedPaymentNotify } from '@juben-sha/shared';
import type { PaymentStatus } from '@juben-sha/shared';
import { randomUUID } from 'crypto';

export class MockPaymentProvider implements PaymentProvider {
  async createPrepay(input: CreatePrepayInput): Promise<CreatePrepayResult> {
    return {
      providerOrderId: `mock_${randomUUID()}`,
      prepayParams: {
        timeStamp: String(Math.floor(Date.now() / 1000)),
        nonceStr: randomUUID(),
        package: `prepay_id=mock_${input.orderId}`,
        signType: 'RSA',
        paySign: 'mock_sign',
      },
    };
  }

  async verifyNotify(): Promise<VerifiedPaymentNotify> {
    return {
      providerTransactionId: `mock_txn_${randomUUID()}`,
      orderId: '',
      amountCents: 0,
      status: 'success',
      paidAt: new Date().toISOString(),
      rawDigest: 'mock_verified',
    };
  }

  normalizeStatus(notify: VerifiedPaymentNotify): PaymentStatus {
    return notify.status;
  }
}
