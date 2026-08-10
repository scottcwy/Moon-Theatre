import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifyAuthMock = vi.fn();
const checkReturnMessagesMock = vi.fn();
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
  checkReturnMessages: checkReturnMessagesMock,
}));

function postRequest() {
  return new NextRequest('http://localhost/api/return-messages/check', { method: 'POST' });
}

describe('POST /api/return-messages/check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns 401 when unauthenticated', async () => {
    verifyAuthMock.mockResolvedValue(null);

    const { POST } = await import('./route.js');
    const response = await POST(postRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(checkReturnMessagesMock).not.toHaveBeenCalled();
  });

  it('returns { messages, characterUnread } on success', async () => {
    verifyAuthMock.mockResolvedValue({ userId: 'user-1' });
    checkReturnMessagesMock.mockResolvedValue({
      messages: [
        {
          id: 'm1',
          characterId: 'char-1',
          characterName: '白藏',
          characterAvatarUrl: '/avatar.jpg',
          content: '好久不见',
          reason: 'recent',
          createdAt: new Date('2026-08-04T01:00:00.000Z'),
          readAt: null,
        },
      ],
      characterUnread: { 'char-1': 1 },
    });

    const { POST } = await import('./route.js');
    const response = await POST(postRequest());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      messages: [
        expect.objectContaining({ id: 'm1', characterId: 'char-1', content: '好久不见' }),
      ],
      characterUnread: { 'char-1': 1 },
    });
    expect(checkReturnMessagesMock).toHaveBeenCalledWith('user-1');
  });

  it('returns 500 when the service throws', async () => {
    verifyAuthMock.mockResolvedValue({ userId: 'user-1' });
    checkReturnMessagesMock.mockRejectedValue(new Error('generator failed'));

    const { POST } = await import('./route.js');
    const response = await POST(postRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal_error' });
  });

  it('exports an OPTIONS handler', async () => {
    const { OPTIONS } = await import('./route.js');
    expect(typeof OPTIONS).toBe('function');
  });
});
