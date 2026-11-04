import type { CreatePrepayInput, CreatePrepayResult, VerifiedPaymentNotify } from '@juben-sha/shared';
import type { PaymentStatus } from '@juben-sha/shared';

export interface PaymentQueryResult {
  providerTransactionId: string;
  orderId: string;
  amountCents: number;
  status: PaymentStatus;
  paidAt: string | null;
}

export class PaymentProviderUnavailableError extends Error {
  readonly code = 'payment_provider_unavailable';

  constructor(message = 'Payment provider does not support order queries') {
    super(message);
    this.name = 'PaymentProviderUnavailableError';
  }
}

export interface PaymentProvider {
  createPrepay(input: CreatePrepayInput): Promise<CreatePrepayResult>;
  verifyNotify(headers: Record<string, string>, rawBody: string): Promise<VerifiedPaymentNotify>;
  normalizeStatus(notify: VerifiedPaymentNotify): PaymentStatus;
  queryPayment(orderId: string): Promise<PaymentQueryResult>;
}
