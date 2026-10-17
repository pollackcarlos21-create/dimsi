import type {
  DeleteAllDataResult,
  UpdateProfileInput,
  UserProfile,
} from '../../../../miniprogram/types/contracts';
import type { AppDependencies } from '../domain/types';
import { emptySchema, updateProfileSchema } from '../domain/schemas';
import { defaultProfile, rateLimit, uniqueStrings } from './common';

export async function getProfile(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
): Promise<UserProfile> {
  emptySchema.parse(payload ?? {});
  const document = await deps.repo.getUser(openid);
  if (!document) return defaultProfile();
  return {
    ...defaultProfile(),
    ...document.profile,
    updatedAt: document.updatedAt,
  };
}

export async function updateProfile(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
): Promise<UserProfile> {
  const patch = updateProfileSchema.parse(payload) as UpdateProfileInput;
  rateLimit(deps, openid, 'updateProfile');
  const existing = await deps.repo.getUser(openid);
  const merged: UserProfile = {
    ...defaultProfile(),
    ...(existing?.profile ?? {}),
    ...patch,
    goals: patch.goals ? uniqueStrings(patch.goals) : existing?.profile.goals ?? [],
    dietaryPreferences: patch.dietaryPreferences
      ? uniqueStrings(patch.dietaryPreferences)
      : existing?.profile.dietaryPreferences ?? [],
    allergies:
      patch.allergies !== undefined
        ? patch.allergies.replace(/[<>]/g, '').trim().slice(0, 80)
        : existing?.profile.allergies ?? '',
  };
  const saved = await deps.repo.upsertUser(openid, merged);
  return { ...saved.profile, updatedAt: saved.updatedAt };
}

async function deleteUploadFiles(
  deps: AppDependencies,
  openid: string,
  requestId: string,
): Promise<{ deleted: number; failures: number }> {
  const uploads = await deps.repo.listAllUploads(openid);
  let deleted = 0;
  let failures = 0;

  for (let index = 0; index < uploads.length; index += 10) {
    const chunk = uploads.slice(index, index + 10);
    const outcomes = await Promise.all(
      chunk.map(async (upload) => {
        if (upload.fileID && !upload.imageDeletedAt) {
          try {
            await deps.storage.deleteFile(upload.fileID);
          } catch (error) {
            deps.logger.warn('account_delete_file_failed', {
              requestId,
              detail: error instanceof Error ? error.name : 'unknown',
            });
            // 文件清理失败时保留上传记录，维护任务可凭 fileID 再次清理。
            return false;
          }
        }
        try {
          await deps.repo.deleteUpload(openid, upload.id);
          return true;
        } catch (error) {
          deps.logger.warn('account_delete_upload_record_failed', {
            requestId,
            detail: error instanceof Error ? error.name : 'unknown',
          });
          return false;
        }
      }),
    );
    for (const success of outcomes) {
      if (success) deleted += 1;
      else failures += 1;
    }
  }
  return { deleted, failures };
}

export async function deleteAllData(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
  requestId: string,
): Promise<DeleteAllDataResult> {
  emptySchema.parse(payload ?? {});
  rateLimit(deps, openid, 'deleteAllData');

  const uploadCleanup = await deleteUploadFiles(deps, openid, requestId);
  const result = await deps.repo.deleteAllForUser(openid);
  deps.logger.info('account_data_deleted', {
    requestId,
    meals: result.deletedMeals,
    conversations: result.deletedConversations,
    uploads: uploadCleanup.deleted,
    uploadFailures: uploadCleanup.failures,
  });
  return {
    deletedMeals: result.deletedMeals,
    deletedConversations: result.deletedConversations,
    deletedUploads: uploadCleanup.deleted,
    fileDeletionFailures: uploadCleanup.failures,
    complete: uploadCleanup.failures === 0,
    userDeleted: result.userDeleted,
  };
}
