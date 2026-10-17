export { AppError } from '../lib/errors';

export const RATE_LIMITS = {
  prepareUpload: 2_000,
  confirmUpload: 500,
  analyzeMeal: 4_000,
  chat: 1_200,
  speakMeal: 1_000,
  updateMealFoods: 1_000,
  updateProfile: 1_000,
  deleteAllData: 10_000,
} as const;

export const CHAT_MESSAGE_LIMIT = 500;
export const CHAT_REPLY_LIMIT = 900;
export const MAX_SPEECH_CHARS = 220;
