import { beforeAll, describe, expect, it } from 'vitest';
import { installMemoryWx } from './fixtures';
import type { NutritionApi } from '../miniprogram/services/types';

let api: NutritionApi;

beforeAll(async () => {
  installMemoryWx();
  const module = await import('../miniprogram/services/localApi');
  api = new module.LocalMockApi();
});

describe('本地演示模式（无任何凭据）', () => {
  it('从本地图片生成明确标记的模拟餐次', async () => {
    const ticket = await api.prepareMealImage({
      path: 'wxfile://demo.jpg',
      sizeBytes: 1200,
      mimeType: 'image/jpeg',
    });
    const meal = await api.analyzeMeal(ticket, {
      mealType: 'lunch',
      requestId: 'req_demo_12345',
    });
    expect(meal.source).toBe('mock');
    expect(meal.warnings.join('')).toContain('演示模式');
    expect(meal.foods.length).toBeGreaterThan(0);
    expect(meal.nutrition.caloriesKcal.min).toBeGreaterThan(0);
    expect(api.mode).toBe('local_mock');
  });

  it('列表、调整、删除与本地数据隔离行为一致', async () => {
    const result = await api.listMeals();
    expect(result.meals.length).toBeGreaterThan(0);
    const meal = result.meals[0];
    const updated = await api.updateMealFoods(meal.id, [
      { id: meal.foods[0].id, name: meal.foods[0].name, portionG: 300 },
    ]);
    expect(updated.foods).toHaveLength(1);
    expect(updated.warnings.join('')).toContain('演示模式');
    await api.deleteMeal(meal.id);
    expect((await api.listMeals()).meals.find((item) => item.id === meal.id)).toBeUndefined();
  });

  it('聊天回复标记为演示来源并可读取', async () => {
    const reply = await api.chat({ message: '晚饭应该吃什么？' });
    expect(reply.source).toBe('mock');
    expect(reply.message.source).toBe('mock');
    expect(reply.message.text.length).toBeGreaterThan(10);
    const conversation = await api.getConversation();
    expect(conversation.messages.length).toBeGreaterThanOrEqual(2);
  });

  it('语音在演示模式明确不可用，而不是伪造音频', async () => {
    await expect(api.speakMeal('demo')).rejects.toMatchObject({ code: 'TTS_UNAVAILABLE' });
  });

  it('资料与清空数据只作用于本地缓存', async () => {
    const saved = await api.updateProfile({
      ageRange: '60-74',
      activityLevel: 'light',
      allowDietHistory: true,
      goals: ['多吃蔬菜'],
    });
    expect(saved.ageRange).toBe('60-74');
    expect(saved.allowDietHistory).toBe(true);
    const result = await api.deleteAllData();
    expect(typeof result.deletedMeals).toBe('number');
    expect((await api.getProfile()).ageRange).toBe('unspecified');
  });
});
