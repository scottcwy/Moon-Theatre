import { z } from 'zod';
import { ValidationError } from '@/server/http/errors.js';
import type { IdentityAdminActor } from '@/server/modules/admin/index.js';

/** Admin writes always act as the authenticated account; a client actor is never accepted. */
export function actorOf(auth: { adminAccountId: string }): IdentityAdminActor {
  return { kind: 'admin_account', adminAccountId: auth.adminAccountId };
}

export function requestIdOf(request: Request): string | undefined {
  return request.headers.get('x-request-id') ?? undefined;
}

const uuid = z.string().uuid();

/** A malformed id is a client error, not a database failure to be reported as a dependency outage. */
export function requireUuid(value: string): string {
  if (!uuid.safeParse(value).success) throw new ValidationError('admin_input_invalid');
  return value;
}
