import { randomUUID } from 'node:crypto';
import type {
  AnalyzeMealInput,
  FoodCorrection,
  IdentifiedFood,
  ListMealsResult,
  MealRecord,
  UpdateMealFoodsInput,
} from '../../../../miniprogram/types/contracts';
import { SCHEMA_VERSION } from '../../../../miniprogram/types/contracts';
import type { AppDependencies, Preparation } from '../domain/types';
import { calculateMeal } from '../domain/nutrition';
import {
  analyzeMealSchema,
  getMealSchema,
  listMealsSchema,
  updateMealFoodsSchema,
} from '../domain/schemas';
import { foodDatabase, inferPreparation } from '../domain/foodDatabase';
import { AppError } from '../lib/errors';
import { inspectImage } from '../lib/image';
import { resolveHistoryDate } from '../lib/time';
import {
  consumeQuota,
  fileIDMatchesCloudPath,
  makeMealRecord,
  rateLimit,
} from './common';

function sanitizeCorrectionName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
  if (!cleaned) {
    throw new AppError('INVALID_INPUT', { message: '食物名称不能为空。' });
  }
  return cleaned;
}

export async function analyzeMeal(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
  requestId: string,
): Promise<MealRecord> {
  const startedAt = Date.now();
  const input = analyzeMealSchema.parse(payload) as AnalyzeMealInput;
  const now = deps.now();
  const nowIso = now.toISOString();
  const staleBeforeIso = new Date(now.getTime() - 2 * 60_000).toISOString();

  const upload = await deps.repo.getUpload(openid, input.uploadId);
  if (!upload) {
    throw new AppError('UPLOAD_NOT_FOUND', { retryable: false });
  }
  if (!fileIDMatchesCloudPath(input.fileID, upload.cloudPath)) {
    throw new AppError('INVALID_INPUT', {
      message: '照片与上传记录不匹配，请重新拍一张。',
    });
  }

  const recoverExisting = async (): Promise<MealRecord | null> => {
    const existing =
      (upload.mealId
        ? await deps.repo.getMeal(openid, upload.mealId)
        : null) ?? (await deps.repo.getMealByUploadId(openid, upload.id));
    if (!existing) return null;
    if (upload.status !== 'used') {
      try {
        await deps.repo.markUploadUsed(
          openid,
          upload.id,
          existing.id,
          upload.fileID ?? input.fileID,
          nowIso,
        );
      } catch (error) {
        deps.logger.warn('upload_state_recovery_failed', {
          requestId,
          detail: error instanceof AppError ? error.code : 'upload_state_error',
        });
      }
    }
    return existing.record;
  };

  if (upload.status !== 'pending') {
    const recovered = await recoverExisting();
    if (recovered) return recovered;
    if (upload.status === 'used') {
      throw new AppError('NOT_FOUND');
    }
    const processingStartedAt = Date.parse(upload.processingAt ?? '');
    if (
      !Number.isFinite(processingStartedAt) ||
      now.getTime() - processingStartedAt < 2 * 60_000
    ) {
      throw new AppError('RATE_LIMITED', {
        message: '这张照片正在分析中，请稍等一会儿再试。',
        retryable: true,
      });
    }
  }

  if (Date.parse(upload.expiresAt) <= now.getTime()) {
    throw new AppError('UPLOAD_EXPIRED', { retryable: false });
  }
  if (upload.fileID && upload.fileID !== input.fileID) {
    throw new AppError('INVALID_INPUT', { message: '照片凭证不匹配，请重新上传。' });
  }

  const claim = await deps.repo.claimUpload(
    openid,
    upload.id,
    nowIso,
    staleBeforeIso,
  );
  if (claim !== 'claimed') {
    const recovered = await deps.repo.getMealByUploadId(openid, upload.id);
    if (recovered) return recovered.record;
    if (claim === 'missing') throw new AppError('UPLOAD_NOT_FOUND');
    if (claim === 'used') throw new AppError('NOT_FOUND');
    throw new AppError('RATE_LIMITED', {
      message: '这张照片正在分析中，请稍等一会儿再试。',
      retryable: true,
    });
  }

  let mealCreated = false;
  try {
    // 在下载和分析前记录 fileID，使未完成分析的上传也能被维护任务清理。
    await deps.repo.attachUploadFile(openid, upload.id, input.fileID);

    rateLimit(deps, openid, 'analyzeMeal');

    const downloadStarted = Date.now();
    const image = await deps.storage.downloadFile(input.fileID);
    const downloadMs = Date.now() - downloadStarted;
    const inspection = inspectImage(image, upload.declaredMimeType, deps.config.maxImageBytes);

    await consumeQuota(deps, openid, 'analysis');

    const aiStarted = Date.now();
    const bundle = await deps.ai.analyzeImage(image, inspection.mimeType);
    const aiMs = Date.now() - aiStarted;

    const calculationStarted = Date.now();
    const calculation = calculateMeal(bundle.recognition);
    const calculationMs = Date.now() - calculationStarted;

    const createdAt = deps.now();
    const meal = makeMealRecord({
      id: randomUUID(),
      mealName: calculation.mealName,
      mealType: input.mealType,
      createdAt,
      calculation,
      source: bundle.source,
      timings: {
        downloadMs,
        aiMs,
        calculationMs,
        totalMs: Date.now() - startedAt,
        aiAttempts: bundle.attempts,
      },
    });

    if (bundle.source === 'mock') {
      meal.warnings = [
        ...meal.warnings,
        '当前结果由服务端演示模式生成，不是对这张照片的真实识别。',
      ];
    }

    await deps.repo.createMeal(openid, meal, upload.id);
    mealCreated = true;

    try {
      await deps.repo.markUploadUsed(
        openid,
        upload.id,
        meal.id,
        input.fileID,
        createdAt.toISOString(),
      );
    } catch (error) {
      // 餐次已经保存。即便幂等状态写入失败，也通过 meal.uploadId 在重试时恢复。
      deps.logger.warn('upload_state_update_failed', {
        requestId,
        detail: error instanceof AppError ? error.code : 'upload_state_error',
      });
    }

    if (deps.config.deleteImageAfterAnalysis) {
      try {
        await deps.storage.deleteFile(input.fileID);
        await deps.repo.markUploadImageDeleted(
          openid,
          upload.id,
          deps.now().toISOString(),
        );
      } catch (error) {
        deps.logger.warn('image_cleanup_failed', {
          requestId,
          detail: error instanceof AppError ? error.code : 'image_cleanup_error',
        });
      }
    }

    deps.logger.info('analysis_completed', {
      requestId,
      source: bundle.source,
      foodCount: meal.foods.length,
      aiMs,
      downloadMs,
      calculationMs,
      totalMs: Date.now() - startedAt,
      attempts: bundle.attempts,
    });

    return meal;
  } catch (error) {
    if (!mealCreated) {
      try {
        await deps.repo.releaseUploadClaim(openid, upload.id, nowIso);
      } catch (releaseError) {
        deps.logger.warn('upload_claim_release_failed', {
          requestId,
          detail:
            releaseError instanceof AppError
              ? releaseError.code
              : 'upload_claim_release_error',
        });
      }
    }
    throw error;
  }
}

export async function getMeal(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
): Promise<MealRecord> {
  const input = getMealSchema.parse(payload);
  const document = await deps.repo.getMeal(openid, input.mealId);
  if (!document) throw new AppError('NOT_FOUND');
  return document.record;
}

export async function listMeals(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
): Promise<ListMealsResult> {
  const input = listMealsSchema.parse(payload);
  let date: string;
  try {
    date = resolveHistoryDate(input.date, deps.now());
  } catch {
    throw new AppError('INVALID_INPUT', { message: '日期无效或超出可查看范围。' });
  }
  const documents = await deps.repo.listMeals(openid, date, 30);
  return { date, meals: documents.map((document) => document.record) };
}

export async function deleteMeal(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
): Promise<{ deleted: true }> {
  const input = getMealSchema.parse(payload);
  const deleted = await deps.repo.deleteMeal(openid, input.mealId);
  if (!deleted) throw new AppError('NOT_FOUND');
  return { deleted: true };
}

export async function updateMealFoods(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
): Promise<MealRecord> {
  const input = updateMealFoodsSchema.parse(payload) as UpdateMealFoodsInput;
  rateLimit(deps, openid, 'updateMealFoods');

  const document = await deps.repo.getMeal(openid, input.mealId);
  if (!document) throw new AppError('NOT_FOUND');
  const existingById = new Map<string, IdentifiedFood>(
    document.record.foods.map((food) => [food.id, food]),
  );

  const foods = input.foods.map((correction: FoodCorrection) => {
    const cleanName = sanitizeCorrectionName(correction.name);
    const previous = correction.id ? existingById.get(correction.id) : undefined;
    const nameChanged = Boolean(previous && previous.name !== cleanName);
    const category = nameChanged
      ? foodDatabase.resolveForCorrection(cleanName).category
      : previous?.category ?? foodDatabase.resolveForCorrection(cleanName).category;
    const portionG = Math.round(correction.portionG);
    return {
      name: cleanName,
      category,
      portionG,
      portionLowG: Math.max(5, Math.round(portionG * 0.9)),
      portionHighG: Math.min(2500, Math.round(portionG * 1.1)),
      confidence: 'medium' as const,
      preparation: (previous?.preparation
        ? previous.preparation
        : inferPreparation(cleanName)) as Preparation,
    };
  });

  const calculation = calculateMeal(
    {
      mealName: document.record.mealName,
      foods,
      oiliness: 'unknown',
      saltinessRisk: 'unknown',
    },
    { corrected: true },
  );

  const updated: MealRecord = {
    ...document.record,
    schemaVersion: SCHEMA_VERSION,
    foods: calculation.foods,
    nutrition: calculation.nutrition,
    assessment: calculation.assessment,
    suggestions: calculation.suggestions,
    nextMeal: calculation.nextMeal,
    activitySuggestion: calculation.activitySuggestion,
    disclaimer: calculation.disclaimer,
    confidence: calculation.confidence,
    oilCaution: calculation.oilCaution,
    saltCaution: calculation.saltCaution,
    warnings: [...calculation.warnings, '营养数据已按你的份量调整重新计算。'],
    timings: undefined,
  };

  const saved = await deps.repo.updateMeal(openid, document.id, updated);
  if (!saved) throw new AppError('NOT_FOUND');
  return updated;
}
