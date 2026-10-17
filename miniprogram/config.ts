import type { MealType } from './types/contracts';

/**
 * 部署前唯一需要修改的前端配置：
 * 填入 CloudBase 环境 ID 后，应用自动切换到云模式。
 * 保持空字符串时，应用使用完整可交互的本地演示模式。
 */
export const CLOUD_ENV_ID = '';

export const appConfig = {
  appName: '知食',
  version: '0.4.0',
  apiFunctionName: 'api',
  cloudEnvId: CLOUD_ENV_ID,
  useCloud: CLOUD_ENV_ID.trim().length > 0,
  maxImageBytes: 5 * 1024 * 1024,
  compressThresholdBytes: 900 * 1024,
  compressQuality: 72,
  analysisTimeoutMs: 60_000,
  mockAnalysisDelayMs: 900,
  mockPageSize: 30,
  supportEmail: '',
  imageRetentionNotice: '分析完成后立即删除原图；餐次记录中不保存照片。',
} as const;

export function inferMealType(now: Date = new Date()): MealType {
  const hour = now.getHours();
  if (hour >= 5 && hour < 10) return 'breakfast';
  if (hour >= 10 && hour < 15) return 'lunch';
  if (hour >= 16 && hour < 21) return 'dinner';
  return 'snack';
}

export const APP_MODE = appConfig.useCloud ? 'cloud' : 'local_mock';
