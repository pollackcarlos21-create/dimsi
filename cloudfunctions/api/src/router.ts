import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type {
  ApiResponse,
  HealthCheckResult,
} from '../../../miniprogram/types/contracts';
import { SCHEMA_VERSION } from '../../../miniprogram/types/contracts';
import type { AppDependencies } from './domain/types';
import { AppError, toAppError } from './lib/errors';
import { makeUserRef } from './lib/logger';
import { analyzeMeal, deleteMeal, getMeal, listMeals, updateMealFoods } from './handlers/analysis';
import { chat, getConversation } from './handlers/chat';
import { cleanupExpired } from './handlers/maintenance';
import { deleteAllData, getProfile, updateProfile } from './handlers/profile';
import { speakMeal } from './handlers/speech';
import { confirmUpload, prepareUpload } from './handlers/upload';
import { assertOpenid } from './handlers/common';

const PUBLIC_ACTIONS = new Set([
  'health',
  'prepareUpload',
  'confirmUpload',
  'analyzeMeal',
  'getMeal',
  'listMeals',
  'updateMealFoods',
  'deleteMeal',
  'getConversation',
  'chat',
  'speakMeal',
  'getProfile',
  'updateProfile',
  'deleteAllData',
]);

export interface RouteInput {
  openid?: string;
  action: unknown;
  payload: unknown;
}

function health(deps: AppDependencies): HealthCheckResult {
  return {
    ok: true,
    aiConfigured: deps.config.aiConfigured,
    aiMode: deps.ai.mode,
    ttsConfigured: deps.tts.configured,
    serverTime: deps.now().toISOString(),
    schemaVersion: SCHEMA_VERSION,
  };
}

export async function handleRequest(
  input: RouteInput,
  deps: AppDependencies,
): Promise<ApiResponse<unknown>> {
  const requestId = randomUUID();
  const action = typeof input.action === 'string' ? input.action : 'unknown';
  const startedAt = Date.now();
  const openid = (input.openid ?? '').trim();
  const userRef = openid ? makeUserRef(openid, deps.config.logHashPepper) : undefined;

  try {
    if (action === 'cleanupExpired') {
      const data = await cleanupExpired(deps, input.payload, requestId);
      return { ok: true, data, requestId };
    }
    if (!PUBLIC_ACTIONS.has(action)) {
      throw new AppError('INVALID_INPUT', { message: '无法识别这个操作。' });
    }
    const authenticatedOpenid = assertOpenid(openid);

    let data: unknown;
    switch (action) {
      case 'health':
        data = health(deps);
        break;
      case 'prepareUpload':
        data = await prepareUpload(deps, authenticatedOpenid, input.payload);
        break;
      case 'confirmUpload':
        data = await confirmUpload(deps, authenticatedOpenid, input.payload);
        break;
      case 'analyzeMeal':
        data = await analyzeMeal(deps, authenticatedOpenid, input.payload, requestId);
        break;
      case 'getMeal':
        data = await getMeal(deps, authenticatedOpenid, input.payload);
        break;
      case 'listMeals':
        data = await listMeals(deps, authenticatedOpenid, input.payload);
        break;
      case 'updateMealFoods':
        data = await updateMealFoods(deps, authenticatedOpenid, input.payload);
        break;
      case 'deleteMeal':
        data = await deleteMeal(deps, authenticatedOpenid, input.payload);
        break;
      case 'getConversation':
        data = await getConversation(deps, authenticatedOpenid, input.payload);
        break;
      case 'chat':
        data = await chat(deps, authenticatedOpenid, input.payload, requestId);
        break;
      case 'speakMeal':
        data = await speakMeal(deps, authenticatedOpenid, input.payload, requestId);
        break;
      case 'getProfile':
        data = await getProfile(deps, authenticatedOpenid, input.payload);
        break;
      case 'updateProfile':
        data = await updateProfile(deps, authenticatedOpenid, input.payload);
        break;
      case 'deleteAllData':
        data = await deleteAllData(deps, authenticatedOpenid, input.payload, requestId);
        break;
      default:
        throw new AppError('INVALID_INPUT');
    }

    return { ok: true, data, requestId };
  } catch (error) {
    const appError =
      error instanceof ZodError
        ? new AppError('INVALID_INPUT', {
            internalDetail: error.issues[0]?.path.join('.') || 'schema_invalid',
          })
        : toAppError(error);
    const logFields = {
      requestId,
      action,
      code: appError.code,
      userRef,
      internalDetail: appError.internalDetail,
      durationMs: Date.now() - startedAt,
    };
    if (appError.logLevel === 'error') {
      deps.logger.error('request_failed', logFields);
    } else {
      deps.logger.warn('request_failed', logFields);
    }
    return {
      ok: false,
      error: appError.toApiError(),
      requestId,
    };
  }
}
