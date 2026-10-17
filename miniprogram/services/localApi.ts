import type {
  ChatMessage,
  ChatReply,
  DeleteAllDataResult,
  GetConversationResult,
  HealthCheckResult,
  ListMealsResult,
  MealRecord,
  NumericRange,
  PrepareUploadResult,
  SpeechResult,
  UpdateProfileInput,
  UserProfile,
} from '../types/contracts';
import { DEFAULT_PROFILE, SCHEMA_VERSION } from '../types/contracts';
import { ApiRequestError } from '../utils/errors';
import { chinaLocalDate } from '../utils/format';
import { randomId } from '../utils/id';
import { storage } from '../utils/storage';
import type {
  AnalyzeMealOptions,
  ChatRequestInput,
  MealUploadTicket,
  NutritionApi,
} from './types';
import { buildMockMeal, mockChatReply } from './mockData';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scaleRange(range: NumericRange, factor: number, step: number): NumericRange {
  const min = Math.max(step, Math.floor((range.min * factor) / step) * step);
  const max = Math.max(min + step, Math.ceil((range.max * factor) / step) * step);
  return { min, max };
}

/**
 * 本地演示实现：所有结果都标记 source=mock，不调用任何外部 AI 或云服务。
 * 数据存放在本机缓存中，删除数据只影响本机演示数据。
 */
export class LocalMockApi implements NutritionApi {
  readonly mode = 'local_mock' as const;

  async prepareMealImage(image: { path: string }): Promise<MealUploadTicket> {
    const startedAt = Date.now();
    await sleep(260);
    return { localPath: image.path, uploadMs: Date.now() - startedAt };
  }

  async analyzeMeal(
    ticket: MealUploadTicket,
    options: AnalyzeMealOptions,
  ): Promise<MealRecord> {
    if (!ticket.localPath) {
      throw new ApiRequestError({
        code: 'INVALID_IMAGE',
        message: '演示模式没有拿到照片，请重新拍一张。',
        retryable: true,
      });
    }
    await sleep(900);
    const meal = buildMockMeal(options.mealType);
    const meals = storage.getDemoMeals().filter((item) => item.id !== meal.id);
    meals.unshift(meal);
    storage.setDemoMeals(meals);
    return meal;
  }

  async getMeal(mealId: string): Promise<MealRecord> {
    const meal = storage.getDemoMeals().find((item) => item.id === mealId);
    if (!meal) {
      throw new ApiRequestError({
        code: 'NOT_FOUND',
        message: '没有找到这条餐次记录。',
        retryable: false,
      });
    }
    return meal;
  }

  async listMeals(date?: string): Promise<ListMealsResult> {
    const localDate = date || chinaLocalDate();
    const meals = storage
      .getDemoMeals()
      .filter((meal) => meal.localDate === localDate)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { date: localDate, meals };
  }

  async updateMealFoods(
    mealId: string,
    corrections: Array<{ id?: string; name: string; portionG: number }>,
  ): Promise<MealRecord> {
    const meals = storage.getDemoMeals();
    const index = meals.findIndex((item) => item.id === mealId);
    if (index < 0) {
      throw new ApiRequestError({
        code: 'NOT_FOUND',
        message: '没有找到这条餐次记录。',
        retryable: false,
      });
    }
    const record = meals[index];
    const previousById = new Map(record.foods.map((food) => [food.id, food]));
    const previousTotal = record.foods.reduce((sum, food) => sum + food.portionG, 0);
    const newTotal = corrections.reduce((sum, food) => sum + food.portionG, 0);
    const factor = previousTotal > 0 ? newTotal / previousTotal : 1;

    const foods = corrections.map((correction) => {
      const previous = correction.id ? previousById.get(correction.id) : undefined;
      const portionG = Math.max(5, Math.min(2000, Math.round(correction.portionG)));
      return {
        id: previous?.id ?? randomId('demo-food_'),
        name: correction.name.trim().slice(0, 30) || previous?.name || '食物',
        matchedName:
          previous?.matchedName ?? (correction.name.trim().slice(0, 30) || '食物'),
        category: previous?.category ?? ('other' as const),
        portionG,
        portionRangeG: {
          min: Math.max(5, Math.round(portionG * 0.9)),
          max: Math.round(portionG * 1.1),
        },
        confidence: 'medium' as const,
        dataSource: previous?.dataSource ?? ('category_fallback' as const),
        preparation: previous?.preparation,
      };
    });

    const updated: MealRecord = {
      ...record,
      foods,
      nutrition: {
        caloriesKcal: scaleRange(record.nutrition.caloriesKcal, factor, 10),
        proteinG: scaleRange(record.nutrition.proteinG, factor, 1),
        fatG: scaleRange(record.nutrition.fatG, factor, 1),
      },
      warnings: [
        ...record.warnings.filter((warning) => !warning.includes('份量调整')),
        '演示模式仅按份量比例调整数值，不会重新识别食物。',
      ],
      timings: undefined,
    };
    meals[index] = updated;
    storage.setDemoMeals(meals);
    return updated;
  }

  async deleteMeal(mealId: string): Promise<{ deleted: true }> {
    const meals = storage.getDemoMeals();
    const next = meals.filter((meal) => meal.id !== mealId);
    if (next.length === meals.length) {
      throw new ApiRequestError({
        code: 'NOT_FOUND',
        message: '这条记录可能已经被删除了。',
        retryable: false,
      });
    }
    storage.setDemoMeals(next);
    return { deleted: true };
  }

  async getConversation(): Promise<GetConversationResult> {
    const messages = storage.getDemoConversation() as unknown as ChatMessage[];
    return {
      conversationId: messages.length > 0 ? 'demo-conversation' : '',
      messages,
    };
  }

  async chat(input: ChatRequestInput): Promise<ChatReply> {
    await sleep(420);
    const existing = storage.getDemoConversation() as unknown as ChatMessage[];
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      text: input.message,
      createdAt: new Date().toISOString(),
    };
    const reply = mockChatReply(input.message);
    storage.setDemoConversation(
      [...existing, userMessage, reply.message] as unknown as Array<Record<string, unknown>>,
    );
    return reply;
  }

  async speakMeal(): Promise<SpeechResult> {
    throw new ApiRequestError({
      code: 'TTS_UNAVAILABLE',
      message: '演示模式不生成真实语音。文字建议仍可照常查看。',
      retryable: false,
    });
  }

  async getProfile(): Promise<UserProfile> {
    return { ...DEFAULT_PROFILE, ...(storage.getDemoProfile() ?? {}) };
  }

  async updateProfile(input: UpdateProfileInput): Promise<UserProfile> {
    const current = await this.getProfile();
    const updated: UserProfile = {
      ...current,
      ...input,
      goals: Array.from(new Set(input.goals ?? current.goals)),
      dietaryPreferences: Array.from(new Set(input.dietaryPreferences ?? current.dietaryPreferences)),
      allergies: (input.allergies ?? current.allergies).replace(/[<>]/g, '').slice(0, 80),
      updatedAt: new Date().toISOString(),
    };
    storage.setDemoProfile(updated);
    return updated;
  }

  async deleteAllData(): Promise<DeleteAllDataResult> {
    const mealCount = storage.getDemoMeals().length;
    const conversationCount = storage.getDemoConversation().length > 0 ? 1 : 0;
    const hadProfile = storage.getDemoProfile() !== null;
    storage.clearDemoData();
    return {
      deletedMeals: mealCount,
      deletedConversations: conversationCount,
      deletedUploads: 0,
      fileDeletionFailures: 0,
      complete: true,
      userDeleted: hadProfile,
    };
  }

  async getHealth(): Promise<HealthCheckResult> {
    return {
      ok: true,
      aiConfigured: false,
      aiMode: 'mock',
      ttsConfigured: false,
      serverTime: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    };
  }
}

export type { PrepareUploadResult };
