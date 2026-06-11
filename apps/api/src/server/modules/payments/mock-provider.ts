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

  async verifyNotify(_headers: Record<string, string>, rawBody: string): Promise<VerifiedPaymentNotify> {
    let orderId = '';
    let amountCents = 0;
    if (rawBody) {
      try {
        const body = JSON.parse(rawBody) as Record<string, unknown>;
        orderId = readString(body.orderId) ?? readString(body.out_trade_no) ?? '';
        amountCents = readAmount(body.amountCents) ?? readAmount(body.total_fee) ?? 0;
      } catch {
        const params = new URLSearchParams(rawBody);
        orderId = params.get('orderId') ?? params.get('out_trade_no') ?? '';
        amountCents = readAmount(params.get('amountCents')) ?? readAmount(params.get('total_fee')) ?? 0;
      }
    }

    return {
      providerTransactionId: `mock_txn_${randomUUID()}`,
      orderId,
      amountCents,
      status: 'success',
      paidAt: new Date().toISOString(),
      rawDigest: 'mock_verified',
    };
  }

  normalizeStatus(notify: VerifiedPaymentNotify): PaymentStatus {
    return notify.status;
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}
