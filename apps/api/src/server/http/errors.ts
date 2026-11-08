import { NextResponse } from 'next/server';
import { z } from 'zod';

import { HttpError, ValidationError } from './error-types.js';
export { HttpError, NotFoundError, ValidationError, ConflictError } from './error-types.js';

export function internalErrorResponse(error?: unknown): NextResponse {
  if (error !== undefined) {
    // 诊断细节只写服务端日志，不向客户端泄漏原始异常（稳定错误码 internal_error）。
    console.error('[internalError] unhandled error:', error);
  }
  return NextResponse.json({ error: 'internal_error' }, { status: 500 });
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: formatZodIssues(error.issues) }, { status: 400 });
  }

  // 非业务错误：不向客户端泄漏原始异常，统一稳定错误码；诊断细节只写服务端日志。
  console.error('[jsonError] unhandled error:', error);
  return internalErrorResponse();
}

export function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.join('.') || 'query'}: ${issue.message}`).join('; ');
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }
}
