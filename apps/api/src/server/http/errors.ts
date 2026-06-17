import { NextResponse } from 'next/server';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NotFoundError extends HttpError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends HttpError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'ValidationError';
  }
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: formatZodIssues(error.issues) }, { status: 400 });
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
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
