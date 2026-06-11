import { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { orders, quotaPackages } from '@/server/db/schema.js';
import { verifyAuth, unauthorizedResponse, successResponse, errorResponse } from '@/server/middleware/auth.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';
import { randomUUID } from 'crypto';

function generateOrderNo(): string {
  return `JB${randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase()}`;
}

const createOrderSchema = z.object({
  quotaPackageId: z.string().uuid(),
});

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse('Invalid request: ' + parsed.error.issues.map((i) => i.message).join(', '), 400);
  }

  const { quotaPackageId } = parsed.data;

  try {
    const [pkg] = await db
      .select()
      .from(quotaPackages)
      .where(eq(quotaPackages.id, quotaPackageId))
      .limit(1);

    if (!pkg || !pkg.active) {
      return errorResponse('Quota package not found', 404);
    }

    const merchantOrderNo = generateOrderNo();

    const [order] = await db
      .insert(orders)
      .values({
        userId: auth.userId,
        quotaPackageId: pkg.id,
        amountCents: pkg.priceCents,
        pointsAmount: pkg.points,
        merchantOrderNo,
        status: 'created',
      })
      .returning();

    if (!order) {
      throw new Error('Failed to create order');
    }

    return successResponse(
      {
        id: order.id,
        merchantOrderNo: order.merchantOrderNo,
        amountCents: order.amountCents,
        pointsAmount: order.pointsAmount,
        status: order.status,
        createdAt: order.createdAt,
      },
      201,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    return errorResponse(message, 500);
  }
}
