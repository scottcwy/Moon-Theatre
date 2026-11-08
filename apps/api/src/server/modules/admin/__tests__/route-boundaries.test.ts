declare global { interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>> } }
import { NextRequest } from 'next/server';
import { expect, it } from 'vitest';
const routes = import.meta.glob('../../../../app/api/admin/**/route.ts');
it('every admin write handler enforces CSRF before business/auth and every absent read is private/no-store', async () => {
  let writes = 0;
  for (const [file, load] of Object.entries(routes)) {
    const handlers = await load() as Record<string, (request: NextRequest, context: unknown) => Promise<Response>>;
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE', 'GET']) {
      if (!handlers[method]) continue;
      const response = await handlers[method]!(new NextRequest('http://localhost:3000/api/admin/test', { method }), { params: Promise.resolve({ id: 'test', idempotencyKey: 'test' }) });
      expect(response.status, `${method} ${file}`).toBe(method === 'GET' ? 401 : 403);
      expect(response.headers.get('cache-control'), `${method} ${file}`).toBe('private, no-store');
      if (method !== 'GET') writes++;
    }
  }
  expect(writes).toBeGreaterThanOrEqual(18);
});
