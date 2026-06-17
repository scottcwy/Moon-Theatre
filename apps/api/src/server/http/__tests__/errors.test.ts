import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError, jsonError, readJsonBody } from '../errors.js';

describe('http error mapping', () => {
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

  it('turns invalid JSON bodies into validation errors', async () => {
    const request = new Request('http://localhost/api/admin/review', {
      method: 'POST',
      body: '{',
    });

    await expect(readJsonBody(request)).rejects.toThrow(ValidationError);
  });
});
