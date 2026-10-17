import { api } from '../../services/api';
import type { MealRecord } from '../../types/contracts';
import { userMessage } from '../../utils/errors';
import { formatRange } from '../../utils/format';

interface HomeSummary {
  count: number;
  calories: string;
}

Page({
  data: {
    isDemo: api.mode === 'local_mock',
    hasMock: false,
    summary: null as HomeSummary | null,
    summaryLoading: true,
    loadError: '',
  },

  onShow() {
    void this.loadSummary();
  },

  async loadSummary() {
    this.setData({ summaryLoading: true, loadError: '' });
    try {
      const result = await api.listMeals();
      const meals = result.meals;
      if (meals.length === 0) {
        this.setData({ summary: null, hasMock: false, summaryLoading: false });
        return;
      }
      const calories = sumRange(meals, 'caloriesKcal');
      this.setData({
        summary: {
          count: meals.length,
          calories: formatRange(calories),
        },
        hasMock: meals.some((meal) => meal.source === 'mock'),
        summaryLoading: false,
      });
    } catch (error) {
      this.setData({
        summaryLoading: false,
        summary: null,
        hasMock: false,
        loadError: userMessage(error),
      });
    }
  },

  onCamera() {
    this.openCapture('camera');
  },

  onAlbum() {
    this.openCapture('album');
  },

  openCapture(source: 'camera' | 'album') {
    const runtime = this as unknown as { navLock?: boolean };
    if (runtime.navLock) return;
    runtime.navLock = true;
    wx.navigateTo({
      url: `/pages/capture/index?source=${source}`,
      complete: () => {
        setTimeout(() => {
          runtime.navLock = false;
        }, 300);
      },
    });
  },

  onViewToday() {
    wx.switchTab({ url: '/pages/meals/index' });
  },

  onOpenChat() {
    wx.switchTab({ url: '/pages/chat/index' });
  },
});

function sumRange(
  meals: MealRecord[],
  key: 'caloriesKcal' | 'proteinG',
): { min: number; max: number } {
  return meals.reduce(
    (total, meal) => ({
      min: total.min + meal.nutrition[key].min,
      max: total.max + meal.nutrition[key].max,
    }),
    { min: 0, max: 0 },
  );
}
