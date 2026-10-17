import { createHash, randomUUID } from 'node:crypto';
import type {
  AnalysisSource,
  MealRecord,
  MealType,
  ServerTimings,
  UserProfile,
} from '../../../../miniprogram/types/contracts';
import { SCHEMA_VERSION } from '../../../../miniprogram/types/contracts';
import { MEAL_DISCLAIMER } from '../domain/advice';
import type {
  AppDependencies,
  MealCalculationResult,
  UsageBucket,
} from '../domain/types';
import { RATE_LIMITS } from '../domain/constants';
import { AppError } from '../lib/errors';
import { chinaDateString } from '../lib/time';

export function assertOpenid(openid: string | undefined): string {
  const value = (openid ?? '').trim();
  if (!value) {
    throw new AppError('UNAUTHENTICATED');
  }
  return value;
}

export function rateLimit(
  deps: AppDependencies,
  openid: string,
  action: keyof typeof RATE_LIMITS,
): void {
  if (!deps.rateLimiter.allow(openid, action, RATE_LIMITS[action])) {
    throw new AppError('RATE_LIMITED', { retryable: true });
  }
}

export async function consumeQuota(
  deps: AppDependencies,
  openid: string,
  bucket: UsageBucket,
): Promise<void> {
  const limit = deps.config.dailyLimits[bucket];
  const result = await deps.repo.consumeUsage(openid, bucket, limit, deps.now());
  if (!result.allowed) {
    throw new AppError('QUOTA_EXCEEDED', {
      message:
        bucket === 'upload'
          ? '今天上传的照片已到上限，明天再来看看吧。'
          : bucket === 'analysis'
            ? '今天的拍照分析次数已到上限，明天再来看看吧。'
            : bucket === 'chat'
              ? '今天的对话次数已到上限，明天再聊吧。'
              : '今天的朗读次数已到上限，明天再听吧。',
    });
  }
}

export function makeMealId(): string {
  return randomUUID();
}

export function makeRequestId(): string {
  return randomUUID();
}

export function makeMealRecord(input: {
  id: string;
  mealName: string;
  mealType: MealType;
  createdAt: Date;
  calculation: MealCalculationResult;
  source: AnalysisSource;
  timings?: ServerTimings;
}): MealRecord {
  const { calculation } = input;
  return {
    id: input.id,
    schemaVersion: SCHEMA_VERSION,
    mealName: calculation.mealName,
    mealType: input.mealType,
    localDate: chinaDateString(input.createdAt),
    createdAt: input.createdAt.toISOString(),
    foods: calculation.foods,
    nutrition: calculation.nutrition,
    assessment: calculation.assessment,
    suggestions: calculation.suggestions,
    nextMeal: calculation.nextMeal,
    activitySuggestion: calculation.activitySuggestion,
    disclaimer: calculation.disclaimer || MEAL_DISCLAIMER,
    confidence: calculation.confidence,
    oilCaution: calculation.oilCaution,
    saltCaution: calculation.saltCaution,
    source: input.source,
    warnings: calculation.warnings,
    timings: input.timings,
  };
}

export function buildSpeechSummary(meal: MealRecord): string {
  const suffix = '营养数据为估算，仅供参考。';
  const calories = `${meal.nutrition.caloriesKcal.min}到${meal.nutrition.caloriesKcal.max}`;
  const protein = `${meal.nutrition.proteinG.min}到${meal.nutrition.proteinG.max}`;
  const firstSuggestion = meal.suggestions[0] ?? '下一餐继续保持有主食、有蛋白质、有蔬菜的搭配。';
  const lead = `${meal.mealName}。这顿饭的热量大约${calories}千卡，蛋白质大约${protein}克。`;
  const body = `${meal.assessment}${firstSuggestion}`;
  const maxCoreLength = 220 - suffix.length;
  let core = `${lead}${body}`;
  if (core.length > maxCoreLength) {
    const cut = core.slice(0, maxCoreLength - 1);
    const lastStop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'));
    core = lastStop > 80 ? cut.slice(0, lastStop + 1) : `${cut}。`;
  }
  return `${core}${suffix}`;
}

export function ownerPathSegment(openid: string): string {
  return createHash('sha256').update(openid).digest('hex').slice(0, 20);
}

export function fileIDMatchesCloudPath(fileID: string, cloudPath: string): boolean {
  if (!fileID.startsWith('cloud://') || !cloudPath) return false;
  if (cloudPath.includes('..') || cloudPath.startsWith('/')) return false;
  return fileID.endsWith(`/${cloudPath}`);
}

export function defaultProfile(): UserProfile {
  return {
    ageRange: 'unspecified',
    activityLevel: 'unspecified',
    goals: [],
    dietaryPreferences: [],
    allergies: '',
    allowDietHistory: false,
  };
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
