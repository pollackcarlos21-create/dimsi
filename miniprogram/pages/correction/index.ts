import { api } from '../../services/api';
import { toApiRequestError } from '../../utils/errors';
import { randomId } from '../../utils/id';

interface FoodDraft {
  key: string;
  id?: string;
  name: string;
  portionText: string;
}

interface CorrectionData {
  state: 'loading' | 'error' | 'ready';
  mealId: string;
  mealName: string;
  source: 'ai' | 'mock';
  foods: FoodDraft[];
  busy: boolean;
  error: string;
}

function clampPortion(value: number): number {
  return Math.min(2000, Math.max(5, Math.round(value)));
}

Page({
  data: {
    state: 'loading',
    mealId: '',
    mealName: '',
    source: 'ai',
    foods: [],
    busy: false,
    error: '',
  } as CorrectionData,

  onLoad(options: Record<string, string | undefined>) {
    (this as unknown as { alive?: boolean }).alive = true;
    if (!options.mealId) {
      this.setData({
        state: 'error',
        error: '没有找到要调整的餐次。',
      });
      return;
    }
    this.setData({ mealId: options.mealId });
    void this.loadMeal(options.mealId);
  },

  async loadMeal(mealId: string) {
    this.setData({ state: 'loading', error: '' });
    try {
      const meal = await api.getMeal(mealId);
      if ((this as unknown as { alive?: boolean }).alive === false) return;
      this.setData({
        state: 'ready',
        mealName: meal.mealName,
        source: meal.source,
        foods: meal.foods.map((food) => ({
          key: food.id,
          id: food.id,
          name: food.name,
          portionText: String(food.portionG),
        })),
      });
    } catch (error) {
      if ((this as unknown as { alive?: boolean }).alive === false) return;
      this.setData({
        state: 'error',
        error: toApiRequestError(error).message,
      });
    }
  },

  onUnload() {
    (this as unknown as { alive?: boolean }).alive = false;
  },

  onNameInput(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    this.setData({
      [`foods[${index}].name`]: String(event.detail.value).slice(0, 30),
    });
  },

  onPortionInput(event: WechatMiniprogram.Input) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    const digits = String(event.detail.value).replace(/[^\d]/g, '').slice(0, 4);
    this.setData({
      [`foods[${index}].portionText`]: digits,
    });
  },

  onAdjustPortion(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const delta = Number(event.currentTarget.dataset.delta);
    if (!Number.isInteger(index) || !Number.isFinite(delta)) return;
    const current = Number(this.data.foods[index]?.portionText || 0);
    this.setData({
      [`foods[${index}].portionText`]: String(clampPortion((current || 100) + delta)),
    });
  },

  onRemoveFood(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    const foods = this.data.foods.filter((_, itemIndex) => itemIndex !== index);
    this.setData({ foods });
  },

  onAddFood() {
    if (this.data.foods.length >= 12) {
      wx.showToast({ title: '最多调整 12 项', icon: 'none' });
      return;
    }
    this.setData({
      foods: [
        ...this.data.foods,
        {
          key: `new-${randomId('food_')}`,
          name: '',
          portionText: '100',
        },
      ],
    });
  },

  async onSave() {
    if (this.data.busy) return;
    if (this.data.foods.length === 0) {
      wx.showToast({ title: '至少保留一项食物', icon: 'none' });
      return;
    }
    const corrections: Array<{ id?: string; name: string; portionG: number }> = [];
    for (const food of this.data.foods) {
      const name = food.name.trim();
      const portion = Number(food.portionText);
      if (!name) {
        wx.showToast({ title: '请填写食物名称', icon: 'none' });
        return;
      }
      if (!Number.isFinite(portion) || portion < 5 || portion > 2000) {
        wx.showToast({ title: '份量请填写 5–2000 克', icon: 'none' });
        return;
      }
      corrections.push({
        id: food.id,
        name,
        portionG: clampPortion(portion),
      });
    }

    this.setData({ busy: true });
    wx.showLoading({ title: '重新估算', mask: true });
    try {
      await api.updateMealFoods(this.data.mealId, corrections);
      if ((this as unknown as { alive?: boolean }).alive === false) {
        wx.hideLoading();
        return;
      }
      wx.hideLoading();
      wx.showToast({ title: '已更新', icon: 'success' });
      wx.navigateBack({
        fail() {
          wx.switchTab({ url: '/pages/meals/index' });
        },
      });
    } catch (error) {
      wx.hideLoading();
      if ((this as unknown as { alive?: boolean }).alive === false) return;
      this.setData({ busy: false });
      wx.showToast({ title: toApiRequestError(error).message, icon: 'none' });
    }
  },

  onRetry() {
    if (this.data.mealId) void this.loadMeal(this.data.mealId);
  },

  onCancel() {
    wx.navigateBack();
  },
});
