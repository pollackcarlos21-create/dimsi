import type {
  SpeakMealInput,
  SpeechResult,
} from '../../../../miniprogram/types/contracts';
import type { AppDependencies } from '../domain/types';
import { speakMealSchema } from '../domain/schemas';
import { AppError } from '../lib/errors';
import { buildSpeechSummary, consumeQuota, rateLimit } from './common';

export async function speakMeal(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
  requestId: string,
): Promise<SpeechResult> {
  const input = speakMealSchema.parse(payload) as SpeakMealInput;
  if (!deps.tts.configured) {
    throw new AppError('TTS_UNAVAILABLE');
  }
  rateLimit(deps, openid, 'speakMeal');

  const document = await deps.repo.getMeal(openid, input.mealId);
  if (!document) throw new AppError('NOT_FOUND');

  await consumeQuota(deps, openid, 'tts');
  const speed = input.speed ?? 1;
  const summary = buildSpeechSummary(document.record);
  const startedAt = Date.now();
  const audio = await deps.tts.synthesize(summary, {
    language: 'mandarin',
    speed,
  });

  deps.logger.info('speech_completed', {
    requestId,
    ttsMs: Date.now() - startedAt,
    chars: summary.length,
  });

  return {
    audioBase64: audio.audioBase64,
    mimeType: audio.mimeType,
    voice: audio.voice,
    speed,
  };
}
