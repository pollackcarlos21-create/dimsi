import type { MealRecord } from '../../types/contracts';
import { formatRange, formatTime, MEAL_TYPE_LABELS } from '../../utils/format';

interface MealCardViewModel {
  name: string;
  typeLabel: string;
  time: string;
  calories: string;
  protein: string;
  source: 'ai' | 'mock';
  demo: boolean;
}

Component({
  properties: {
    meal: {
      type: Object,
      value: null,
    },
  },
  data: {
    view: null as MealCardViewModel | null,
  },
  observers: {
    meal() {
      this.refreshView();
    },
  },
  lifetimes: {
    attached() {
      this.refreshView();
    },
  },
  methods: {
    refreshView() {
      const meal = this.data.meal as MealRecord | null;
      if (!meal) {
        this.setData({ view: null });
        return;
      }
      this.setData({
        view: {
          name: meal.mealName,
          typeLabel: MEAL_TYPE_LABELS[meal.mealType],
          time: formatTime(meal.createdAt),
          calories: formatRange(meal.nutrition.caloriesKcal),
          protein: formatRange(meal.nutrition.proteinG),
          source: meal.source,
          demo: meal.source === 'mock',
        },
      });
    },
    onSelect() {
      const meal = this.data.meal as MealRecord | null;
      if (!meal) return;
      this.triggerEvent('select', { mealId: meal.id });
    },
  },
});
