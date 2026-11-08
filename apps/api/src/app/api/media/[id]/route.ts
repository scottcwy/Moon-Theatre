import { NextRequest, NextResponse } from 'next/server';
import { MediaError, findMediaAsset, readMediaAssetBytes } from '@/server/modules/media/index.js';

/**
 * `GET /api/media/[id]` — the only delivery surface. There is no path parameter and no directory
 * listing: the id names one `media_assets` row, and the file path is derived server-side from that
 * row's validated sha256 + allowlisted mime. Content-addressed bytes never change, so the response
 * is immutable for a year and carries a strong ETag derived from the same hash.
 */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

function notFound() {
  return NextResponse.json(
    { error: 'media_not_found' },
    { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}

function storeUnavailable() {
  return NextResponse.json(
    { error: 'media_store_unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const asset = await findMediaAsset(id);
    if (!asset) return notFound();

    const etag = `"${asset.contentHash}"`;
    const cacheHeaders = {
      ETag: etag,
      'Cache-Control': IMMUTABLE_CACHE,
      'X-Content-Type-Options': 'nosniff',
    };
    // A conditional request costs no file read: the hash is the identity of the bytes.
    const conditional = (request.headers.get('if-none-match') ?? '').split(',').map(value => value.trim());
    if (conditional.includes('*') || conditional.includes(etag)) {
      return new NextResponse(null, { status: 304, headers: cacheHeaders });
    }

    const bytes = await readMediaAssetBytes(asset);
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        ...cacheHeaders,
        'Content-Type': asset.mime,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': 'inline',
      },
    });
  } catch (error) {
    if (error instanceof MediaError) {
      return error.status === 404 ? notFound() : storeUnavailable();
    }
    return storeUnavailable();
  }
}
