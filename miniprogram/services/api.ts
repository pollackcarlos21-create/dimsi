import { appConfig } from '../config';
import { CloudApi } from './cloudApi';
import { LocalMockApi } from './localApi';
import type { NutritionApi } from './types';

/**
 * 模式在启动时确定，不做静默降级：
 * - 未配置 CloudBase：完整本地演示模式；
 * - 已配置 CloudBase：真实云函数模式，错误会明确暴露。
 */
export const api: NutritionApi = appConfig.useCloud ? new CloudApi() : new LocalMockApi();

export type { NutritionApi };
