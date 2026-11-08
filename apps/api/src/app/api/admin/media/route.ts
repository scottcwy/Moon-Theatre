import { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/server/middleware/auth.js';
import {
  adminJsonError as jsonError,
  adminSuccessResponse as successResponse,
} from '@/server/modules/admin/security.js';
import {
  MEDIA_MAX_BYTES,
  MediaBodyTooLargeError,
  readBoundedBody,
  storeMediaAsset,
} from '@/server/modules/media/index.js';
import { MediaError } from '@/server/modules/media/errors.js';
import { requestIdOf } from '../shared.js';

/**
 * `POST /api/admin/media` — raw-body upload (documented contract: `Content-Type` is one of
 * `application/octet-stream`, `image/png`, `image/jpeg`, `image/webp`; the declared value is IGNORED
 * for typing and only the magic bytes decide). Order: guard/CSRF → bounded read → sniff → dimension
 * header → hash → temp+rename → insert. The service returns the immutable URL; nothing about the
 * server filesystem, the original filename or the raw bytes is returned or audited.
 *
 * The guard gets the named `media_upload` body kind; `validateAdminWrite` accepts those content types
 * only on this exact path, so no other admin write can inherit the exception by accident.
 */
export async function POST(request: NextRequest) {
  const admin = await verifyAdminAuth(request, { body: 'media_upload' });
  if (!admin.ok) return admin.response;
  try {
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBody(request.body, MEDIA_MAX_BYTES);
    } catch (error) {
      // The bound is enforced while reading, so an oversized body never reaches the service.
      if (error instanceof MediaBodyTooLargeError) throw new MediaError('media_too_large');
      throw error;
    }
    if (bytes.byteLength === 0) throw new MediaError('media_type_unsupported');
    const asset = await storeMediaAsset({
      bytes,
      actor: { kind: 'admin_account', adminAccountId: admin.auth.adminAccountId },
      requestId: requestIdOf(request),
    });
    return successResponse(asset);
  } catch (error) {
    return jsonError(error);
  }
}
