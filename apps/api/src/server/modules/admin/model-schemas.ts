import { z } from 'zod';
import {
  MODEL_DESCRIPTION_MAX,
  MODEL_DISPLAY_NAME_MAX,
  MODEL_IDEMPOTENCY_KEY_MAX,
  MODEL_NAME_MAX,
  MODEL_PROVIDER_MAX,
} from './model-limits.js';
import { modelRuntimeParamsIssues } from './model-runtime-params.js';

/**
 * Strict HTTP boundary for the model tier console (AC-15 / AC-17).
 *
 * Everything is refused unless it was declared:
 *  - `tier` is immutable and is not a writable field — it is an unknown key here, so a tier change is a
 *    400 before any service call (the service repeats the check for programmatic callers);
 *  - a credential field (`apiKey`, `credentialRef`, a token) is an unknown key — secrets live only in
 *    the server environment and are never accepted, echoed, audited or versioned;
 *  - `pointsPerCall` is an integer ≥ 0; provider/model/display name are bounded trimmed strings;
 *  - `runtimeParams` is the allowlisted declaration described in `model-runtime-params.ts`.
 *
 * Dependency-free apart from zod so the route tests exercise the REAL schema, not a mirror of it.
 */
export const modelRuntimeParamsSchema = z.record(z.unknown()).superRefine((value, context) => {
  for (const issue of modelRuntimeParamsIssues(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: issue });
});

export const modelProfileUpdateSchema = z.object({
  id: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(MODEL_IDEMPOTENCY_KEY_MAX),
  /** The `model_profiles.updated_at` the operator loaded; a different value is a 409, never a silent write. */
  expectedUpdatedAt: z.string().trim().min(1).max(64),
  enabled: z.boolean().optional(),
  pointsPerCall: z.number().int().min(0).optional(),
  displayName: z.string().trim().min(1).max(MODEL_DISPLAY_NAME_MAX).optional(),
  description: z.string().trim().max(MODEL_DESCRIPTION_MAX).nullable().optional(),
  provider: z.string().trim().min(1).max(MODEL_PROVIDER_MAX).optional(),
  modelName: z.string().trim().min(1).max(MODEL_NAME_MAX).optional(),
  runtimeParams: modelRuntimeParamsSchema.optional(),
}).strict();

export const modelPublishSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(MODEL_IDEMPOTENCY_KEY_MAX),
  expectedUpdatedAt: z.string().trim().min(1).max(64),
  /** Named version = restore/publish that payload as a NEW current version; absent = publish the stored config. */
  versionId: z.string().uuid().optional(),
}).strict();

export type ModelProfileUpdateBody = z.infer<typeof modelProfileUpdateSchema>;
export type ModelPublishBody = z.infer<typeof modelPublishSchema>;
