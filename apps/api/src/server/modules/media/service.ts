import { createHash } from 'node:crypto';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { db } from '../../db/index.js';
import { mediaAssets } from '../../db/schema.js';
import { recordAdminAuditInTransaction, type IdentityAdminActor } from '../admin/audit.js';
import { MediaError } from './errors.js';
import { MEDIA_MAX_BYTES, type MediaMime } from './limits.js';
import {
  MediaFileError,
  hasMediaFile,
  isValidMediaDimensions,
  readImageDimensions,
  readMediaFile,
  sniffImageMime,
  writeMediaFile,
} from './storage.js';

type AdminMediaActor = Extract<IdentityAdminActor, { kind: 'admin_account' }>;

export type MediaAssetRow = typeof mediaAssets.$inferSelect;

export interface MediaAssetView {
  id: string;
  url: string;
  mime: string;
  byteSize: number;
  width: number;
  height: number;
  reused: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The URL is absolute on purpose: the miniapp loads `avatarUrl`/`coverUrl` directly from a different
 * origin, so a root-relative path would render as a local file. It is derived from the configured
 * canonical origin (never from a request Host header) and the immutable asset id.
 */
export function mediaUrl(id: string): string {
  return `${config.adminOrigin}/api/media/${id}`;
}

export function mediaAssetView(row: MediaAssetRow, reused: boolean): MediaAssetView {
  return {
    id: row.id,
    url: mediaUrl(row.id),
    mime: row.mime,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    reused,
  };
}

export async function findMediaAsset(id: string): Promise<MediaAssetRow | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
  return row ?? null;
}

async function findMediaAssetByHash(contentHash: string): Promise<MediaAssetRow | null> {
  const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.contentHash, contentHash)).limit(1);
  return row ?? null;
}

/**
 * Bytes → signature sniff → header-only dimensions → sha256 → one row per hash.
 *
 * Order matters for both honesty and safety: the declared content type is never trusted (a GIF
 * declared as PNG is refused), the body was already bounded by the route, and the file is written
 * through a temp file + rename BEFORE the row is inserted — that order is what guarantees the only
 * forbidden state is impossible: there can never be a row without a file.
 *
 * A failed insert deliberately leaves the just-written file in place. Content addressing makes an
 * orphan file harmless (it is never served: delivery resolves bytes from a row) and self-healing (the
 * next upload of the same bytes inserts the row and reuses the file), while deleting it could race a
 * concurrent identical upload that already observed the file and then inserts its row — which would
 * produce exactly the "row without a file" state the brief forbids. The asymmetry is the safe one.
 */
export async function storeMediaAsset(input: {
  bytes: Uint8Array;
  actor: AdminMediaActor;
  requestId?: string;
  root?: string;
}): Promise<MediaAssetView> {
  const root = input.root ?? path.resolve(config.mediaRoot);
  if (input.bytes.byteLength === 0) throw new MediaError('media_type_unsupported');
  if (input.bytes.byteLength > MEDIA_MAX_BYTES) throw new MediaError('media_too_large');

  const mime: MediaMime | null = sniffImageMime(input.bytes);
  if (!mime) throw new MediaError('media_type_unsupported');
  const dimensions = readImageDimensions(input.bytes, mime);
  if (!dimensions || !isValidMediaDimensions(dimensions.width, dimensions.height)) {
    throw new MediaError('media_dimensions_invalid');
  }

  const contentHash = createHash('sha256').update(input.bytes).digest('hex');
  const existing = await findMediaAssetByHash(contentHash);
  if (existing) {
    // Identical bytes: reuse the row and the URL. Re-write only if the file is missing (a repaired
    // store, never an overwrite with different content) and never append a second audit event.
    if (!await hasMediaFile(root, existing.contentHash, existing.mime)) {
      await guardStore(() => writeMediaFile(root, existing.contentHash, existing.mime, input.bytes));
    }
    return mediaAssetView(existing, true);
  }

  try {
    await writeMediaFile(root, contentHash, mime, input.bytes);
  } catch {
    throw new MediaError('media_store_unavailable');
  }

  let inserted: MediaAssetRow | null;
  try {
    inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(mediaAssets)
        .values({
          contentHash,
          mime,
          byteSize: input.bytes.byteLength,
          width: dimensions.width,
          height: dimensions.height,
          originalName: null,
          createdByAdminAccountId: input.actor.adminAccountId,
        })
        .onConflictDoNothing({ target: mediaAssets.contentHash })
        .returning();
      if (!row) return null;
      // Audited for a NEW asset only; a reuse never reaches this insert. No bytes, no filename, no
      // path in the summary — the content hash and the parsed facts are enough to trace it.
      await recordAdminAuditInTransaction(tx, {
        actor: input.actor,
        action: 'admin.media.upload',
        objectType: 'media_asset',
        objectId: row.id,
        requestId: input.requestId,
        result: 'committed',
        summary: { contentHash, mime, byteSize: row.byteSize, width: row.width, height: row.height },
      });
      return row;
    });
  } catch (error) {
    // The file stays on disk on purpose (see the docstring above): an orphan file is harmless and
    // self-healing, whereas deleting it can leave a concurrent identical upload's row without a file.
    if (error instanceof MediaError) throw error;
    throw new MediaError('media_store_unavailable');
  }

  if (!inserted) {
    // A concurrent upload of the same bytes won the unique index: reuse it, no second audit.
    const winner = await findMediaAssetByHash(contentHash);
    if (!winner) throw new MediaError('media_store_unavailable');
    return mediaAssetView(winner, true);
  }
  return mediaAssetView(inserted, false);
}

async function guardStore<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MediaFileError && error.code === 'invalid_path') throw new MediaError('media_not_found');
    throw new MediaError('media_store_unavailable');
  }
}

/**
 * Delivery bytes for one row. A row whose path values fail validation (a corrupted or hand-edited
 * row) is reported as not found instead of being resolved against the filesystem.
 */
export async function readMediaAssetBytes(asset: MediaAssetRow, root?: string): Promise<Uint8Array> {
  try {
    return await readMediaFile(root ?? path.resolve(config.mediaRoot), asset.contentHash, asset.mime);
  } catch (error) {
    if (error instanceof MediaFileError && (error.code === 'not_found' || error.code === 'invalid_path')) {
      throw new MediaError('media_not_found');
    }
    throw new MediaError('media_store_unavailable');
  }
}
