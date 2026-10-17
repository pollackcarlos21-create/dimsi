import { randomUUID } from 'node:crypto';
import type {
  PrepareUploadInput,
  PrepareUploadResult,
} from '../../../../miniprogram/types/contracts';
import { AppError } from '../lib/errors';
import { addMinutes } from '../lib/time';
import { extensionForMimeType } from '../lib/image';
import type { AppDependencies } from '../domain/types';
import { confirmUploadSchema, prepareUploadSchema } from '../domain/schemas';
import { consumeQuota, fileIDMatchesCloudPath, ownerPathSegment, rateLimit } from './common';

export async function prepareUpload(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
): Promise<PrepareUploadResult> {
  const input = prepareUploadSchema.parse(payload) as PrepareUploadInput;
  rateLimit(deps, openid, 'prepareUpload');

  if (input.sizeBytes > deps.config.maxImageBytes) {
    throw new AppError('IMAGE_TOO_LARGE');
  }

  const now = deps.now();
  const activeCount = await deps.repo.countActiveUploads(openid, now.toISOString());
  if (activeCount >= 10) {
    throw new AppError('RATE_LIMITED', {
      message: '还有好几张照片没有分析完成，请先完成其中一张再拍。',
      retryable: true,
    });
  }

  await consumeQuota(deps, openid, 'upload');

  const uploadId = randomUUID();
  const extension = extensionForMimeType(input.mimeType);
  const cloudPath = `meal-images/${ownerPathSegment(openid)}/${uploadId}.${extension}`;
  const expiresAt = addMinutes(now, 15);

  await deps.repo.createUpload({
    id: uploadId,
    ownerOpenId: openid,
    cloudPath,
    declaredMimeType: input.mimeType,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  return {
    uploadId,
    cloudPath,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * 客户端上传完成后立即登记 fileID，使“上传了但从未分析”的图片也能在票据过期后被清理。
 * analyzeMeal 中仍会再次校验并补登记，作为旧客户端/网络失败的兜底。
 */
export async function confirmUpload(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
): Promise<{ registered: true }> {
  const input = confirmUploadSchema.parse(payload);
  rateLimit(deps, openid, 'confirmUpload');
  const upload = await deps.repo.getUpload(openid, input.uploadId);
  if (!upload) throw new AppError('UPLOAD_NOT_FOUND');
  if (!fileIDMatchesCloudPath(input.fileID, upload.cloudPath)) {
    throw new AppError('INVALID_INPUT', { message: '照片与上传记录不匹配。' });
  }
  if (Date.parse(upload.expiresAt) <= deps.now().getTime()) {
    throw new AppError('UPLOAD_EXPIRED', { retryable: false });
  }
  if (upload.fileID && upload.fileID !== input.fileID) {
    throw new AppError('INVALID_INPUT', { message: '照片凭证不匹配，请重新上传。' });
  }
  if (upload.status !== 'used') {
    await deps.repo.attachUploadFile(openid, upload.id, input.fileID);
  }
  return { registered: true };
}
