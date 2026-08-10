import { describe, expect, it, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { NotFoundError, ValidationError, jsonError, readJsonBody } from '../errors.js';

describe('http error mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps validation errors to 400 responses', async () => {
    const response = jsonError(new ValidationError('query: invalid status'));

    await expect(response.json()).resolves.toEqual({ error: 'query: invalid status' });
    expect(response.status).toBe(400);
  });

  it('maps not found errors to 404 responses', async () => {
    const response = jsonError(new NotFoundError('Session'));

    await expect(response.json()).resolves.toEqual({ error: 'Session not found' });
    expect(response.status).toBe(404);
  });

  it('maps zod errors to 400 responses with formatted issues', async () => {
    const response = jsonError(new z.ZodError([
      {
        code: 'invalid_type',
        expected: 'number',
        received: 'string',
        path: ['page'],
        message: 'Expected number',
      },
    ]));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'page: Expected number' });
  });

  it('maps unknown errors to stable internal_error without leaking details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = new Error('secret db detail: connection refused');

    const response = jsonError(original);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal_error' });
    // 诊断细节只进服务端日志，不回给客户端。
    expect(consoleError).toHaveBeenCalledWith('[jsonError] unhandled error:', original);
  });

  it('maps non-Error thrown values to stable internal_error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = jsonError('boom');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal_error' });
  });

  it('turns invalid JSON bodies into validation errors', async () => {
    const request = new Request('http://localhost/api/admin/review', {
      method: 'POST',
      body: '{',
    });

    await expect(readJsonBody(request)).rejects.toThrow(ValidationError);
  });
});
