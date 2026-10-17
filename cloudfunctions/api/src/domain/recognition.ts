import { z } from 'zod';
import {
  CONFIDENCE_LEVELS,
  FOOD_CATEGORIES,
  type FoodCategory,
} from '../../../../miniprogram/types/contracts';
import type {
  Oiliness,
  Preparation,
  RecognitionFood,
  RecognitionResult,
  SaltinessRisk,
} from './types';

const PREPARATIONS = [
  'steamed',
  'boiled',
  'stir_fried',
  'deep_fried',
  'braised',
  'cold',
  'grilled',
  'raw',
  'packaged',
  'unknown',
] as const;

const RISKS = ['low', 'medium', 'high', 'unknown'] as const;

export class RecognitionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecognitionParseError';
  }
}

function cleanText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

const numberFromModel = z.coerce.number().finite();

const FoodSchema = z.object({
  name: z.string().transform((value) => cleanText(value, 30)),
  category: z.enum(FOOD_CATEGORIES).catch('other'),
  portion_g: numberFromModel.min(1).max(3000),
  portion_low_g: numberFromModel.optional(),
  portion_high_g: numberFromModel.optional(),
  confidence: z.enum(CONFIDENCE_LEVELS).catch('medium'),
  preparation: z.enum(PREPARATIONS).catch('unknown'),
  visual_note: z.string().optional(),
});

const RecognitionSchema = z.object({
  meal_name: z.string().transform((value) => cleanText(value, 30)),
  foods: z.array(FoodSchema).min(1).max(12),
  oiliness: z.enum(RISKS).catch('unknown'),
  saltiness_risk: z.enum(RISKS).catch('unknown'),
  observation: z.string().optional(),
});

function extractJsonCandidate(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unwrapped = fenced ? fenced[1].trim() : trimmed;
  const start = unwrapped.indexOf('{');
  const end = unwrapped.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new RecognitionParseError('no_json_object');
  }
  return unwrapped.slice(start, end + 1);
}

function normalizeFood(raw: z.infer<typeof FoodSchema>): RecognitionFood {
  const estimate = Math.min(2000, Math.max(5, Math.round(raw.portion_g)));
  const lowCandidate = raw.portion_low_g ?? estimate * 0.75;
  const highCandidate = raw.portion_high_g ?? estimate * 1.25;
  const low = Math.round(
    Math.min(estimate, Math.max(estimate * 0.5, Math.min(lowCandidate, estimate))),
  );
  const high = Math.round(
    Math.max(estimate, Math.min(estimate * 1.5, Math.max(highCandidate, estimate))),
  );

  return {
    name: raw.name,
    category: raw.category,
    portionG: estimate,
    portionLowG: Math.max(5, low),
    portionHighG: Math.max(estimate, high),
    confidence: raw.confidence,
    preparation: raw.preparation as Preparation,
    visualNote: raw.visual_note ? cleanText(raw.visual_note, 60) : undefined,
  };
}

function fallbackMealName(foods: RecognitionFood[]): string {
  const names = foods.slice(0, 2).map((food) => food.name).filter(Boolean);
  return names.length > 0 ? names.join('和') : '这一餐';
}

export function parseRecognitionContent(content: string): RecognitionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonCandidate(content));
  } catch (error) {
    if (error instanceof RecognitionParseError) throw error;
    throw new RecognitionParseError('invalid_json');
  }

  const validated = RecognitionSchema.safeParse(parsed);
  if (!validated.success) {
    throw new RecognitionParseError(`schema_invalid:${validated.error.issues[0]?.path.join('.')}`);
  }

  const foods = validated.data.foods
    .filter((food) => food.name.length > 0)
    .map(normalizeFood);
  if (foods.length === 0) {
    throw new RecognitionParseError('empty_foods');
  }

  return {
    mealName: validated.data.meal_name || fallbackMealName(foods),
    foods,
    oiliness: validated.data.oiliness as Oiliness,
    saltinessRisk: validated.data.saltiness_risk as SaltinessRisk,
    observation: validated.data.observation
      ? cleanText(validated.data.observation, 100)
      : undefined,
  };
}

export function makeRecognitionResult(
  mealName: string,
  foods: RecognitionFood[],
  oiliness: Oiliness = 'unknown',
  saltinessRisk: SaltinessRisk = 'unknown',
): RecognitionResult {
  return { mealName: cleanText(mealName, 30) || fallbackMealName(foods), foods, oiliness, saltinessRisk };
}

export function categoryLabel(category: FoodCategory): string {
  const labels: Record<FoodCategory, string> = {
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
    mixed: '混合菜肴',
    other: '其他',
  };
  return labels[category];
}
