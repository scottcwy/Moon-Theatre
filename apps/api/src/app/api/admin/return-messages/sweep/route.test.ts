import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const verifyAdminAuthMock = vi.fn();
const sweepReturnMessagesMock = vi.fn();
const successResponseMock = vi.fn((data: unknown, status = 200) =>
  Response.json(data, { status }),
);
const jsonErrorMock = vi.fn((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Internal server error';
  return Response.json({ error: message }, { status: 500 });
});

vi.mock('@/server/middleware/auth.js', () => ({
  verifyAdminAuth: verifyAdminAuthMock,
  successResponse: successResponseMock,
}));

vi.mock('@/server/middleware/cors.js', () => ({
  corsPreflightResponse: vi.fn(),
}));

vi.mock('@/server/http/errors.js', () => ({
  jsonError: jsonErrorMock,
}));

vi.mock('@/server/modules/return-messages/index.js', () => ({
  sweepReturnMessages: sweepReturnMessagesMock,
}));

function postRequest() {
  return new NextRequest('http://localhost/api/admin/return-messages/sweep', { method: 'POST' });
}

describe('POST /api/admin/return-messages/sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns the admin 401 response when unauthenticated', async () => {
    verifyAdminAuthMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const { POST } = await import('./route.js');
    const response = await POST(postRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(sweepReturnMessagesMock).not.toHaveBeenCalled();
  });

  it('returns the admin 403 response for a non-admin', async () => {
    verifyAdminAuthMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const { POST } = await import('./route.js');
    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(sweepReturnMessagesMock).not.toHaveBeenCalled();
  });

  it('sweeps and returns { swept: true } for an admin', async () => {
    verifyAdminAuthMock.mockResolvedValue({ ok: true, auth: { userId: 'admin-1' } });
    sweepReturnMessagesMock.mockResolvedValue(undefined);

    const { POST } = await import('./route.js');
    const response = await POST(postRequest());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({ swept: true });
    expect(sweepReturnMessagesMock).toHaveBeenCalledTimes(1);
  });

  it('passes service errors to jsonError', async () => {
    verifyAdminAuthMock.mockResolvedValue({ ok: true, auth: { userId: 'admin-1' } });
    const failure = new Error('sweep failed');
    sweepReturnMessagesMock.mockRejectedValue(failure);

    const { POST } = await import('./route.js');
    const response = await POST(postRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'sweep failed' });
    expect(jsonErrorMock).toHaveBeenCalledWith(failure);
  });

  it('exports an OPTIONS handler', async () => {
    const { OPTIONS } = await import('./route.js');
    expect(typeof OPTIONS).toBe('function');
  });
});
