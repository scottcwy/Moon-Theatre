/**
 * Field bounds of the model tier console. Dependency-free on purpose: the strict API schema and the
 * browser form import the same numbers (the pattern already used by `quota-package-limits.ts`), so a
 * value the form accepts can never be one the server refuses for a different reason.
 */
export const MODEL_PROVIDER_MAX = 64;
export const MODEL_NAME_MAX = 128;
export const MODEL_DISPLAY_NAME_MAX = 64;
export const MODEL_DESCRIPTION_MAX = 256;
export const MODEL_IDEMPOTENCY_KEY_MAX = 128;
