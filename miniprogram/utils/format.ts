import type {
  Confidence,
  FoodCategory,
  MealType,
  NumericRange,
} from '../types/contracts';

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

export const FOOD_CATEGORY_LABELS: Record<FoodCategory, string> = {
  staple: '主食',
  vegetable: '蔬菜',
  meat: '肉类',
  poultry: '禽肉',
  fish: '水产',
  egg: '蛋类',
  soy: '豆制品',
  soup: '汤品',
  fruit: '水果',
  dairy: '奶类',
  nuts: '坚果',
  pastry: '糕点',
  beverage: '饮品',
  mixed: '混合菜',
  other: '其他',
};

export const MEAL_TYPE_SHORT: Record<MealType, string> = {
  breakfast: '早',
  lunch: '午',
  dinner: '晚',
  snack: '加',
};

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: '参考范围较宽',
  medium: '大致估算',
  high: '比较有把握',
};

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function chinaLocalDate(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

export function formatDateLabel(date: Date = new Date()): string {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatRelativeDate(localDate: string, now: Date = new Date()): string {
  const today = chinaLocalDate(now);
  const yesterday = chinaLocalDate(new Date(now.getTime() - 86_400_000));
  if (localDate === today) return '今天';
  if (localDate === yesterday) return '昨天';
  const [, month, day] = localDate.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return '夜深了';
  if (hour < 10) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function formatRange(range: NumericRange): string {
  if (range.min === range.max) return String(range.min);
  return `${range.min}–${range.max}`;
}

export function formatCalories(range: NumericRange): string {
  return `${formatRange(range)}`;
}

export function formatGrams(range: NumericRange): string {
  return `${formatRange(range)}`;
}

export function formatPortion(food: { portionG: number; portionRangeG: NumericRange }): string {
  if (food.portionRangeG.min === food.portionRangeG.max) return `约 ${food.portionG} 克`;
  return `约 ${food.portionRangeG.min}–${food.portionRangeG.max} 克`;
}

export function confidenceLabel(confidence: Confidence): string {
  return CONFIDENCE_LABELS[confidence];
}

export function sourceLabel(source: 'ai' | 'mock'): string {
  return source === 'mock' ? '演示数据' : 'AI 估算';
}

export function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
