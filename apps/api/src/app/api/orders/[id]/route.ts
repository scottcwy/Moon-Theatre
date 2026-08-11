import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db/index.js';
import { orders, quotaPackages } from '@/server/db/schema.js';
import { verifyAuth, unauthorizedResponse, successResponse, errorResponse } from '@/server/middleware/auth.js';
import { internalErrorResponse } from '@/server/http/errors.js';
import { corsPreflightResponse } from '@/server/middleware/cors.js';

export async function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await verifyAuth(request);
  if (!auth) {
    return unauthorizedResponse();
  }

  const { id } = await params;

  try {
    const [order] = await db
      .select({
        id: orders.id,
        userId: orders.userId,
        amountCents: orders.amountCents,
        pointsAmount: orders.pointsAmount,
        status: orders.status,
        merchantOrderNo: orders.merchantOrderNo,
        providerTransactionId: orders.providerTransactionId,
        paidAt: orders.paidAt,
        creditedAt: orders.creditedAt,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        packageName: quotaPackages.name,
        packagePoints: quotaPackages.points,
      })
      .from(orders)
      .leftJoin(quotaPackages, eq(orders.quotaPackageId, quotaPackages.id))
      .where(eq(orders.id, id))
      .limit(1);

    if (!order) {
      return errorResponse('Order not found', 404);
    }

    if (order.userId !== auth.userId) {
      return errorResponse('Order not found', 404);
    }

    return successResponse(order);
  } catch (err) {
    return internalErrorResponse(err);
  }
}
