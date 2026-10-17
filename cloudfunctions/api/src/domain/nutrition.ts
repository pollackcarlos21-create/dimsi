import type {
  Confidence,
  FoodCategory,
  IdentifiedFood,
  MealNutrition,
  NumericRange,
} from '../../../../miniprogram/types/contracts';
import { AppError } from '../lib/errors';
import {
  buildMealAdvice,
  MEAL_DISCLAIMER,
  oilCautionFor,
  saltCautionFor,
} from './advice';
import { foodDatabase, type ResolvedFood } from './foodDatabase';
import type {
  MealCalculationResult,
  Oiliness,
  RecognitionFood,
  RecognitionResult,
  SaltinessRisk,
} from './types';

interface NutrientAccumulator {
  caloriesKcal: [number, number];
  proteinG: [number, number];
  fatG: [number, number];
}

const OIL_RANK: Record<Oiliness, number> = {
  unknown: -1,
  low: 0,
  medium: 1,
  high: 2,
};
const SALT_RANK: Record<SaltinessRisk, number> = {
  unknown: -1,
  low: 0,
  medium: 1,
  high: 2,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function maxLevel<T extends string>(a: T, b: T, rank: Record<T, number>): T {
  return rank[a] >= rank[b] ? a : b;
}

function roundOut(range: [number, number], step: number, minimumMax: number): NumericRange {
  const min = Math.floor(range[0] / step) * step;
  let max = Math.ceil(range[1] / step) * step;
  if (max < minimumMax) max = minimumMax;
  if (max < min) max = min + step;
  return { min, max };
}

function overallConfidence(
  foods: IdentifiedFood[],
  nutrition: MealNutrition,
): Confidence {
  if (foods.length === 0) return 'low';
  const lowCount = foods.filter(
    (food) => food.confidence === 'low' || food.dataSource === 'category_fallback',
  ).length;
  const mid = (nutrition.caloriesKcal.min + nutrition.caloriesKcal.max) / 2;
  const widthRatio =
    mid > 0 ? (nutrition.caloriesKcal.max - nutrition.caloriesKcal.min) / mid : 1;

  if (lowCount >= Math.ceil(foods.length / 2) || widthRatio > 0.9) return 'low';
  if (lowCount > 0 || foods.some((food) => food.confidence === 'medium')) return 'medium';
  return 'high';
}

function buildFood(
  food: RecognitionFood,
  index: number,
  resolved: ResolvedFood,
): IdentifiedFood {
  const estimate = Math.round(clamp(food.portionG, 5, 2000));
  const lowerBound = Math.max(5, Math.floor(estimate * 0.5));
  const upperBound = Math.max(estimate, Math.min(2500, Math.ceil(estimate * 1.5)));
  const rawLow = Number.isFinite(food.portionLowG) ? food.portionLowG : estimate * 0.75;
  const rawHigh = Number.isFinite(food.portionHighG) ? food.portionHighG : estimate * 1.25;
  const low = Math.round(clamp(rawLow, lowerBound, estimate));
  const high = Math.round(clamp(rawHigh, estimate, upperBound));

  return {
    id: `food-${index + 1}`,
    name: resolved.inputName || food.name,
    matchedName: resolved.matchedName,
    category: resolved.category,
    portionG: estimate,
    portionRangeG: { min: low, max: high },
    confidence:
      resolved.dataSource === 'category_fallback'
        ? 'low'
        : food.confidence,
    dataSource: resolved.dataSource,
    preparation: food.preparation,
    note: resolved.note,
  };
}

export function calculateMeal(
  recognition: RecognitionResult,
  options: { corrected?: boolean } = {},
): MealCalculationResult {
  const sourceFoods = recognition.foods.slice(0, 12);
  if (sourceFoods.length === 0) {
    throw new AppError('RECOGNITION_EMPTY', { retryable: true });
  }

  const totals: NutrientAccumulator = {
    caloriesKcal: [0, 0],
    proteinG: [0, 0],
    fatG: [0, 0],
  };
  const foods: IdentifiedFood[] = [];
  const warnings = new Set<string>();
  const categoryCounts: Partial<Record<FoodCategory, number>> = {};
  let oil: Oiliness = recognition.oiliness;
  let salt: SaltinessRisk = recognition.saltinessRisk;

  for (const [index, food] of sourceFoods.entries()) {
    const resolved = foodDatabase.resolve(food.name, food.category);
    const item = buildFood(food, index, resolved);
    foods.push(item);

    if (resolved.note) warnings.add(resolved.note);
    categoryCounts[resolved.category] = (categoryCounts[resolved.category] ?? 0) + 1;
    oil = maxLevel(oil, resolved.oiliness, OIL_RANK);
    salt = maxLevel(salt, resolved.saltinessRisk, SALT_RANK);

    const lowPortion = item.portionRangeG.min / 100;
    const highPortion = item.portionRangeG.max / 100;
    totals.caloriesKcal[0] += resolved.per100g.caloriesKcal[0] * lowPortion;
    totals.caloriesKcal[1] += resolved.per100g.caloriesKcal[1] * highPortion;
    totals.proteinG[0] += resolved.per100g.proteinG[0] * lowPortion;
    totals.proteinG[1] += resolved.per100g.proteinG[1] * highPortion;
    totals.fatG[0] += resolved.per100g.fatG[0] * lowPortion;
    totals.fatG[1] += resolved.per100g.fatG[1] * highPortion;
  }

  const caloriesKcal = roundOut(totals.caloriesKcal, 10, 10);
  const proteinG = roundOut(totals.proteinG, 1, 1);
  const fatG = roundOut(totals.fatG, 1, 1);
  const nutrition: MealNutrition = { caloriesKcal, proteinG, fatG };
  const confidence = overallConfidence(foods, nutrition);

  if (confidence === 'low') {
    warnings.add('部分食物的份量或种类把握不大，营养区间已适当放宽。');
  }
  warnings.add('油盐提示只参考照片与菜名，无法据此测量实际含量。');

  const advice = buildMealAdvice({
    nutrition,
    categoryCounts,
    oiliness: oil,
    saltinessRisk: salt,
    corrected: options.corrected,
  });
  const oilCaution = oilCautionFor(oil);
  const saltCaution = saltCautionFor(salt);

  return {
    mealName: recognition.mealName,
    foods,
    nutrition,
    confidence,
    oilCaution,
    saltCaution,
    ...advice,
    disclaimer: MEAL_DISCLAIMER,
    warnings: Array.from(warnings).slice(0, 5),
    categoryCounts,
  };
}
