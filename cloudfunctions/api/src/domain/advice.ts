import type { FoodCategory, MealNutrition } from '../../../../miniprogram/types/contracts';

export const MEAL_DISCLAIMER =
  '营养数值由食物成分数据和照片份量估算，可能与实际有差异，照片也无法精确测量油盐含量。结果仅供日常饮食参考，不能替代医疗或营养专业建议。如有食物过敏，请核对实际配料并选择安全的替代食物。';

interface AdviceInput {
  nutrition: MealNutrition;
  categoryCounts: Partial<Record<FoodCategory, number>>;
  oiliness: 'low' | 'medium' | 'high' | 'unknown';
  saltinessRisk: 'low' | 'medium' | 'high' | 'unknown';
  corrected?: boolean;
}

function midpoint(min: number, max: number): number {
  return (min + max) / 2;
}

function hasAny(
  counts: Partial<Record<FoodCategory, number>>,
  categories: FoodCategory[],
): boolean {
  return categories.some((category) => (counts[category] ?? 0) > 0);
}

export function buildMealAdvice(input: AdviceInput): {
  assessment: string;
  suggestions: string[];
  nextMeal: string;
  activitySuggestion: string;
} {
  const hasVegetable = hasAny(input.categoryCounts, ['vegetable']);
  const hasProtein = hasAny(input.categoryCounts, ['meat', 'poultry', 'fish', 'egg', 'soy']);
  const hasMixed = hasAny(input.categoryCounts, ['mixed']);
  const hasStaple = hasAny(input.categoryCounts, ['staple']);
  const proteinMid = midpoint(input.nutrition.proteinG.min, input.nutrition.proteinG.max);
  const calorieMid = midpoint(
    input.nutrition.caloriesKcal.min,
    input.nutrition.caloriesKcal.max,
  );

  let opening: string;
  if (hasVegetable && hasProtein && hasStaple) {
    opening = '这顿饭有主食、蔬菜和蛋白质来源，搭配比较完整。';
  } else if (hasMixed && hasStaple) {
    opening = '这顿饭有主食，也有家常菜，是常见的家庭搭配。';
  } else if (hasProtein && hasStaple) {
    opening = '这顿饭有主食和蛋白质，能提供比较实在的饱腹感。';
  } else if (hasVegetable && hasStaple) {
    opening = '这顿饭有主食也有蔬菜，是一顿常见的家常搭配。';
  } else if (hasProtein) {
    opening = '这顿饭有蛋白质来源，这一点很好。';
  } else {
    opening = '这顿饭已经记录下来了，了解自己的日常饮食就是一个好开始。';
  }

  if (input.oiliness === 'high') {
    opening += '从照片看可能偏油一些。';
  } else if (input.oiliness === 'medium') {
    opening += '看起来有一些油，但照片无法判断实际用油量。';
  }

  if (input.corrected) {
    opening = `已按你的调整重新估算。${opening}`;
  }

  const suggestions: string[] = [];
  if (proteinMid < 12) {
    suggestions.push('下一顿可以补充一点优质蛋白质，比如鸡蛋、豆腐、鱼或瘦肉。');
  } else if (proteinMid >= 25) {
    suggestions.push('这顿饭的蛋白质来源比较充足，下一餐保持适量就好。');
  } else {
    suggestions.push('下一餐可以继续搭配一份蛋白质食物，帮助吃得更均衡。');
  }

  if (!hasVegetable) {
    suggestions.push('可以再加一份深色蔬菜，比如菠菜、西兰花或油麦菜。');
  } else {
    suggestions.push('蔬菜可以换着颜色吃，深色蔬菜多一些会更好。');
  }

  if (input.oiliness === 'high') {
    suggestions.push('下次做菜可以少放一点油，多试试蒸、煮、炖的做法。');
  } else if (input.oiliness === 'medium') {
    suggestions.push('炒菜时稍微少放一点油，味道通常也足够。');
  }

  if (input.saltinessRisk === 'high') {
    suggestions.push('照片看不出盐量。如果平时口味偏咸，可以慢慢减少酱油和盐。');
  }

  if (calorieMid > 950) {
    suggestions.push('这一餐能量比较充足，下一餐吃到七八分饱、清淡一些即可。');
  } else if (calorieMid < 250) {
    suggestions.push('这一餐比较轻，下一餐记得正常吃，不需要刻意少吃。');
  }

  if (suggestions.length < 2) {
    suggestions.push('不用追求每一顿都完美，保持规律吃饭更重要。');
  }

  let nextMeal: string;
  if (proteinMid < 12) {
    nextMeal = '下一餐可以选鱼、鸡蛋、豆腐或瘦肉，再配一份蔬菜和适量主食。';
  } else if (!hasVegetable) {
    nextMeal = '下一餐可以加一份深色蔬菜，再搭配适量主食和蛋白质食物。';
  } else if (input.oiliness === 'high') {
    nextMeal = '下一餐可以清淡一些，比如清蒸鱼、绿叶菜和适量米饭。';
  } else {
    nextMeal = '下一餐保持有主食、有蛋白质、有蔬菜的搭配，口味清淡一些就很好。';
  }

  return {
    assessment: opening,
    suggestions: suggestions.slice(0, 4),
    nextMeal,
    activitySuggestion: '如果身体允许，饭后慢慢走一走，感觉轻松就好，不必用运动去“抵消”这一餐。',
  };
}

export function oilCautionFor(
  level: 'low' | 'medium' | 'high' | 'unknown',
): { level: 'low' | 'medium' | 'high' | 'unknown'; message: string } {
  switch (level) {
    case 'high':
      return {
        level,
        message: '从照片和菜品类型看，这顿饭可能偏油。照片无法测量实际用油量。',
      };
    case 'medium':
      return {
        level,
        message: '看起来有一些油。若想清淡一点，下一餐可以多选蒸、煮、炖。',
      };
    case 'low':
      return {
        level,
        message: '从照片看油腻程度不高；实际用油量无法仅凭照片判断。',
      };
    default:
      return {
        level: 'unknown',
        message: '仅凭照片难以判断用油量，以实际烹饪方式为准。',
      };
  }
}

export function saltCautionFor(
  level: 'low' | 'medium' | 'high' | 'unknown',
): { level: 'low' | 'medium' | 'high' | 'unknown'; message: string } {
  switch (level) {
    case 'high':
      return {
        level,
        message: '这道菜可能偏咸。照片无法测量盐含量，可以留意酱油、盐和咸味调料。',
      };
    case 'medium':
      return {
        level,
        message: '照片无法判断咸淡，可以留意酱油和盐的使用，按口味适量就好。',
      };
    default:
      return {
        level: level === 'low' ? 'low' : 'unknown',
        message: '照片无法测量盐含量，日常烹饪仍建议适量用盐。',
      };
  }
}
