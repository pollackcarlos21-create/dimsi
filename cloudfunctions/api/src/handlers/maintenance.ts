import { createHash, timingSafeEqual } from 'node:crypto';
import type { AppDependencies } from '../domain/types';
import { cleanupExpiredSchema } from '../domain/schemas';
import { AppError } from '../lib/errors';

function safeCompare(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

export async function cleanupExpired(
  deps: AppDependencies,
  payload: unknown,
  requestId: string,
): Promise<{ deletedFiles: number; deletedRecords: number; failed: number }> {
  const input = cleanupExpiredSchema.parse(payload);
  if (!deps.rateLimiter.allow('maintenance', 'cleanupExpired', 5_000)) {
    throw new AppError('RATE_LIMITED', { retryable: true });
  }
  if (!deps.config.maintenanceSecret) {
    throw new AppError('UNAUTHENTICATED', {
      message: '维护接口未启用或凭证无效。',
    });
  }
  if (!safeCompare(input.secret, deps.config.maintenanceSecret)) {
    throw new AppError('UNAUTHENTICATED', {
      message: '维护接口未启用或凭证无效。',
    });
  }

  const uploads = await deps.repo.getExpiredUploads(input.limit ?? 50);
  let deletedFiles = 0;
  let deletedRecords = 0;
  let failed = 0;

  for (const upload of uploads) {
    let canDelete = true;
    if (upload.fileID && !upload.imageDeletedAt) {
      try {
        await deps.storage.deleteFile(upload.fileID);
        deletedFiles += 1;
      } catch (error) {
        canDelete = false;
        failed += 1;
        deps.logger.warn('expired_file_cleanup_failed', {
          requestId,
          detail: error instanceof Error ? error.name : 'unknown',
        });
      }
    }
    if (canDelete) {
      await deps.repo.deleteUpload(upload.ownerOpenId, upload.id);
      deletedRecords += 1;
    }
  }

  deps.logger.info('expired_cleanup_completed', {
    requestId,
    deletedFiles,
    deletedRecords,
    failed,
  });
  return { deletedFiles, deletedRecords, failed };
}
