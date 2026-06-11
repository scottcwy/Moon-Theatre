import type { CreatePrepayInput, CreatePrepayResult, VerifiedPaymentNotify } from '../schemas/payment.schema.js';
import type { PaymentStatus } from '../constants.js';

export interface PaymentProvider {
  createPrepay(input: CreatePrepayInput): Promise<CreatePrepayResult>;
  verifyNotify(headers: Record<string, string>, rawBody: string): Promise<VerifiedPaymentNotify>;
  normalizeStatus(notify: VerifiedPaymentNotify): PaymentStatus;
}