import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifyAuthMock = vi.fn();
const markCharacterMessagesReadMock = vi.fn();
const errorResponseMock = vi.fn((message: string, status = 500) =>
  Response.json({ error: message }, { status }),
);
const successResponseMock = vi.fn((data: unknown, status = 200) =>
  Response.json(data, { status }),
);
const unauthorizedResponseMock = vi.fn(() =>
  Response.json({ error: 'Unauthorized' }, { status: 401 }),
);

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAuth: verifyAuthMock,
  errorResponse: errorResponseMock,
  successResponse: successResponseMock,
  unauthorizedResponse: unauthorizedResponseMock,
}));

vi.mock('@/server/middleware/cors.js', () => ({
  corsPreflightResponse: vi.fn(),
}));

vi.mock('@/server/modules/return-messages/index.js', () => ({
  markCharacterMessagesRead: markCharacterMessagesReadMock,
}));

function postRequest(body: unknown) {
  return new NextRequest('http://localhost/api/return-messages/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/return-messages/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 401 when unauthenticated', async () => {
    verifyAuthMock.mockResolvedValue(null);

    const { POST } = await import('./route.js');
    const response = await POST(postRequest({ characterId: 'char-1' }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(markCharacterMessagesReadMock).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON without calling the service', async () => {
    verifyAuthMock.mockResolvedValue({ userId: 'user-1' });

    const { POST } = await import('./route.js');
    const response = await POST(new NextRequest('http://localhost/api/return-messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid characterId' });
    expect(markCharacterMessagesReadMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid body', async () => {
    verifyAuthMock.mockResolvedValue({ userId: 'user-1' });

    const { POST } = await import('./route.js');
    const response = await POST(postRequest({ characterId: '' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid characterId' });
    expect(markCharacterMessagesReadMock).not.toHaveBeenCalled();
  });

  it('marks the character messages read and returns { updated }', async () => {
    verifyAuthMock.mockResolvedValue({ userId: 'user-1' });
    markCharacterMessagesReadMock.mockResolvedValue(2);

    const { POST } = await import('./route.js');
    const response = await POST(postRequest({ characterId: 'char-1' }));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ updated: 2 });
    expect(markCharacterMessagesReadMock).toHaveBeenCalledWith('user-1', 'char-1');
  });

  it('returns 500 when the service throws', async () => {
    verifyAuthMock.mockResolvedValue({ userId: 'user-1' });
    markCharacterMessagesReadMock.mockRejectedValue(new Error('database unavailable'));

    const { POST } = await import('./route.js');
    const response = await POST(postRequest({ characterId: 'char-1' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal_error' });
  });

  it('exports an OPTIONS handler', async () => {
    const { OPTIONS } = await import('./route.js');
    expect(typeof OPTIONS).toBe('function');
  });
});
