import { api } from '../../services/api';
import type { MealRecord } from '../../types/contracts';
import { toApiRequestError } from '../../utils/errors';
import { formatDateLabel, formatRange } from '../../utils/format';

interface MealsSummary {
  count: number;
  calories: string;
  protein: string;
  fat: string;
}

Page({
  data: {
    isDemo: api.mode === 'local_mock',
    hasMock: false,
    dateLabel: '',
    loading: true,
    error: '',
    meals: [] as MealRecord[],
    summary: null as MealsSummary | null,
  },

  onShow() {
    this.setData({ dateLabel: formatDateLabel() });
    void this.loadMeals();
  },

  onPullDownRefresh() {
    void this.loadMeals().finally(() => wx.stopPullDownRefresh());
  },

  async loadMeals() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.listMeals();
      const meals = result.meals;
      this.setData({
        meals,
        summary: meals.length > 0 ? summarize(meals) : null,
        hasMock: meals.some((meal) => meal.source === 'mock'),
        loading: false,
      });
    } catch (error) {
      this.setData({
        loading: false,
        hasMock: false,
        error: toApiRequestError(error).message,
      });
    }
  },

  onOpenMeal(event: WechatMiniprogram.CustomEvent<{ mealId: string }>) {
    const mealId = event.detail.mealId;
    if (!mealId) return;
    wx.navigateTo({ url: `/pages/result/index?mealId=${mealId}` });
  },

  onCapture() {
    wx.navigateTo({ url: '/pages/capture/index?source=camera' });
  },

  onRetry() {
    void this.loadMeals();
  },
});

function summarize(meals: MealRecord[]): MealsSummary {
  const calories = { min: 0, max: 0 };
  const protein = { min: 0, max: 0 };
  const fat = { min: 0, max: 0 };
  for (const meal of meals) {
    calories.min += meal.nutrition.caloriesKcal.min;
    calories.max += meal.nutrition.caloriesKcal.max;
    protein.min += meal.nutrition.proteinG.min;
    protein.max += meal.nutrition.proteinG.max;
    fat.min += meal.nutrition.fatG.min;
    fat.max += meal.nutrition.fatG.max;
  }
  return {
    count: meals.length,
    calories: formatRange(calories),
    protein: formatRange(protein),
    fat: formatRange(fat),
  };
}
