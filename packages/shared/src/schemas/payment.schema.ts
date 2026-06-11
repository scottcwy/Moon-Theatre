import { z } from 'zod';

export const createPrepayInputSchema = z.object({
  orderId: z.string(),
  userId: z.string(),
  amountCents: z.number().int().positive(),
  description: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreatePrepayInput = z.infer<typeof createPrepayInputSchema>;

export const createPrepayResultSchema = z.object({
  providerOrderId: z.string(),
  prepayParams: z.record(z.string(), z.string()),
});

export type CreatePrepayResult = z.infer<typeof createPrepayResultSchema>;

export const verifiedPaymentNotifySchema = z.object({
  providerTransactionId: z.string(),
  orderId: z.string(),
  amountCents: z.number().int(),
  status: z.enum(['success', 'failed', 'cancelled']),
  paidAt: z.string().nullable(),
  rawDigest: z.string().optional(),
});

export type VerifiedPaymentNotify = z.infer<typeof verifiedPaymentNotifySchema>;

export const paymentStatusSchema = z.enum(['pending', 'success', 'failed', 'cancelled']);

export type PaymentStatusSchema = z.infer<typeof paymentStatusSchema>;