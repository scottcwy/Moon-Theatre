import type { CreatePrepayInput, CreatePrepayResult, VerifiedPaymentNotify } from '@juben-sha/shared';
import type { PaymentStatus } from '@juben-sha/shared';

export interface PaymentProvider {
  createPrepay(input: CreatePrepayInput): Promise<CreatePrepayResult>;
  verifyNotify(headers: Record<string, string>, rawBody: string): Promise<VerifiedPaymentNotify>;
  normalizeStatus(notify: VerifiedPaymentNotify): PaymentStatus;
}