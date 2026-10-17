import { FOOD_CATEGORIES, type FoodCategory } from '../../../../miniprogram/types/contracts';
import rawDatabase from '../data/food-database.json';
import type { Oiliness, Preparation, SaltinessRisk } from './types';

type Range = [number, number];

interface FoodComposition {
  caloriesKcal: Range;
  proteinG: Range;
  fatG: Range;
}

interface FoodItem {
  id: string;
  name: string;
  aliases: string[];
  category: FoodCategory;
  defaultPortionG: number;
  per100g: FoodComposition;
  oiliness: Oiliness;
  saltinessRisk: SaltinessRisk;
}

interface CategoryFallback {
  label: string;
  defaultPortionG: number;
  per100g: FoodComposition;
  oiliness: Oiliness;
  saltinessRisk: SaltinessRisk;
}

export interface FoodDatabaseFile {
  version: string;
  scope: string;
  license: string;
  sources: Array<{ name: string; use: string; url: string }>;
  limitations: string;
  items: FoodItem[];
  categoryFallbacks: Record<FoodCategory, CategoryFallback>;
}

export interface ResolvedFood {
  inputName: string;
  matchedName: string;
  itemId: string;
  category: FoodCategory;
  per100g: FoodComposition;
  defaultPortionG: number;
  oiliness: Oiliness;
  saltinessRisk: SaltinessRisk;
  dataSource: 'database' | 'category_fallback';
  note?: string;
}

const database = rawDatabase as unknown as FoodDatabaseFile;

const CATEGORY_KEYWORDS: Array<[FoodCategory, string[]]> = [
  ['staple', ['饭', '面', '粥', '粉', '馒头', '包', '饼', '饺', '馄饨', '云吞', '玉米', '红薯', '土豆']],
  ['vegetable', ['菜', '瓜', '茄', '豆角', '西兰花', '萝卜', '藕', '笋', '菌', '菇', '木耳']],
  ['meat', ['猪', '牛', '羊', '肉', '排骨']],
  ['poultry', ['鸡', '鸭', '鹅', '禽']],
  ['fish', ['鱼', '虾', '蟹', '贝', '海鲜']],
  ['egg', ['蛋']],
  ['soy', ['豆腐', '豆干', '腐竹', '豆皮', '黄豆']],
  ['soup', ['汤', '羹']],
  ['fruit', ['苹果', '香蕉', '橙', '橘', '梨', '葡萄', '西瓜', '水果']],
  ['dairy', ['奶', '酸奶', '芝士']],
  ['nuts', ['核桃', '花生', '杏仁', '腰果', '瓜子']],
  ['pastry', ['蛋糕', '饼', '糕', '面包', '油条', '曲奇']],
  ['beverage', ['茶', '咖啡', '可乐', '汽水', '豆浆', '果汁']],
];

export function normalizeFoodName(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/^(一份|一盘|一碗|一碟|大份|小份|半份)/, '')
    .replace(/[\s，。！？、,.!?:;；:""''·\-—_/\\]/g, '')
    .trim()
    .slice(0, 40);
}

function inferCategory(name: string): FoodCategory {
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => name.includes(keyword))) return category;
  }
  return 'other';
}

const PREPARATION_HINTS: Array<[Preparation, string[]]> = [
  ['deep_fried', ['炸', '油条', '天妇罗']],
  ['stir_fried', ['炒', '爆', '煸', '煎']],
  ['braised', ['红烧', '卤', '酱', '焖', '炖']],
  ['cold', ['凉拌', '拍']],
  ['steamed', ['蒸']],
  ['boiled', ['煮', '白灼', '水煮', '汤']],
  ['grilled', ['烤']],
  ['raw', ['生', '刺身']],
];

export function inferPreparation(name: string): Preparation {
  for (const [preparation, keywords] of PREPARATION_HINTS) {
    if (keywords.some((keyword) => name.includes(keyword))) return preparation;
  }
  return 'unknown';
}

class FoodDatabase {
  readonly version = database.version;
  private readonly exactIndex = new Map<string, FoodItem>();
  private readonly aliases: Array<{ alias: string; item: FoodItem }> = [];
  private readonly fallbacks = database.categoryFallbacks;

  constructor(private readonly data: FoodDatabaseFile) {
    for (const item of data.items) {
      const names = [item.name, ...item.aliases];
      for (const name of names) {
        const normalized = normalizeFoodName(name);
        if (!normalized) continue;
        if (!this.exactIndex.has(normalized)) {
          this.exactIndex.set(normalized, item);
        }
        if (normalized.length >= 2) {
          this.aliases.push({ alias: normalized, item });
        }
      }
    }
    this.aliases.sort((a, b) => b.alias.length - a.alias.length);
  }

  getMeta(): Pick<FoodDatabaseFile, 'version' | 'scope' | 'license' | 'sources' | 'limitations'> {
    const { version, scope, license, sources, limitations } = this.data;
    return { version, scope, license, sources, limitations };
  }

  getItem(name: string): FoodItem | undefined {
    return this.exactIndex.get(normalizeFoodName(name));
  }

  resolve(inputName: string, categoryHint: FoodCategory = 'other'): ResolvedFood {
    const normalized = normalizeFoodName(inputName);
    const hint = categoryHint === 'other' ? inferCategory(normalized) : categoryHint;

    const exact = this.exactIndex.get(normalized);
    if (exact) {
      return this.fromItem(inputName, exact);
    }

    for (const entry of this.aliases) {
      if (!normalized.includes(entry.alias)) continue;
      // 当视觉模型给出了明确的细分品类，避免把“鸡蛋汤”误配成“水煮蛋”。
      if (
        hint !== 'mixed' &&
        hint !== 'other' &&
        entry.item.category !== hint &&
        entry.alias.length < normalized.length
      ) {
        break;
      }
      return this.fromItem(inputName, entry.item);
    }

    const fallbackCategory: FoodCategory = hint in this.fallbacks ? hint : 'other';
    const fallback = this.fallbacks[fallbackCategory];
    return {
      inputName,
      matchedName: fallback.label,
      itemId: `fallback_${fallbackCategory}`,
      category: fallbackCategory,
      per100g: fallback.per100g,
      defaultPortionG: fallback.defaultPortionG,
      oiliness: fallback.oiliness,
      saltinessRisk: fallback.saltinessRisk,
      dataSource: 'category_fallback',
      note: `「${inputName}」未在精选成分库中，已按${fallback.label}的范围估算。`,
    };
  }

  resolveForCorrection(name: string, previousCategory?: FoodCategory): ResolvedFood {
    const category = previousCategory ?? inferCategory(normalizeFoodName(name));
    return this.resolve(name, category);
  }

  private fromItem(inputName: string, item: FoodItem): ResolvedFood {
    return {
      inputName,
      matchedName: item.name,
      itemId: item.id,
      category: item.category,
      per100g: item.per100g,
      defaultPortionG: item.defaultPortionG,
      oiliness: item.oiliness,
      saltinessRisk: item.saltinessRisk,
      dataSource: 'database',
    };
  }
}

export const foodDatabase = new FoodDatabase(database);

export function assertFoodDatabaseIntegrity(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const item of database.items) {
    if (ids.has(item.id)) errors.push(`duplicate item id: ${item.id}`);
    ids.add(item.id);
    for (const nutrient of Object.values(item.per100g)) {
      if (!Array.isArray(nutrient) || nutrient.length !== 2) {
        errors.push(`invalid range: ${item.id}`);
        continue;
      }
      if (nutrient[0] < 0 || nutrient[1] < nutrient[0]) {
        errors.push(`invalid range order: ${item.id}`);
      }
    }
    if (!Array.isArray(item.aliases) || item.aliases.length === 0) {
      errors.push(`missing aliases: ${item.id}`);
    }
  }
  for (const category of FOOD_CATEGORIES) {
    if (!database.categoryFallbacks[category]) {
      errors.push(`missing fallback: ${category}`);
    }
  }
  return errors;
}
