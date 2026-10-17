import type { ChatReply, MealRecord, MealType } from '../types/contracts';
import { chinaLocalDate } from '../utils/format';

const DISCLAIMER =
  '营养数值由食物成分数据和照片份量估算，可能与实际有差异，照片也无法精确测量油盐含量。结果仅供日常饮食参考，不能替代医疗或营养专业建议。如有食物过敏，请核对实际配料并选择安全的替代食物。';

const DEMO_WARNING = '当前为本地演示模式，结果不来自对照片的真实识别。';

function makeId(): string {
  return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const MEALS: Array<Omit<MealRecord, 'id' | 'createdAt' | 'localDate' | 'mealType'>> = [
  {
    schemaVersion: 2,
    mealName: '青椒肉丝配米饭',
    foods: [
      {
        id: 'food-1',
        name: '米饭',
        matchedName: '米饭',
        category: 'staple',
        portionG: 150,
        portionRangeG: { min: 120, max: 180 },
        confidence: 'medium',
        dataSource: 'database',
        preparation: 'steamed',
      },
      {
        id: 'food-2',
        name: '青椒肉丝',
        matchedName: '青椒肉丝',
        category: 'mixed',
        portionG: 160,
        portionRangeG: { min: 130, max: 190 },
        confidence: 'medium',
        dataSource: 'database',
        preparation: 'stir_fried',
      },
    ],
    nutrition: {
      caloriesKcal: { min: 460, max: 620 },
      proteinG: { min: 17, max: 24 },
      fatG: { min: 16, max: 25 },
    },
    assessment: '这顿饭有主食和蛋白质，能提供比较实在的饱腹感。看起来有一些油，但照片无法判断实际用油量。',
    suggestions: [
      '下一餐可以继续搭配一份蛋白质食物，帮助吃得更均衡。',
      '蔬菜可以换着颜色吃，深色蔬菜多一些会更好。',
      '炒菜时稍微少放一点油，味道通常也足够。',
    ],
    nextMeal: '下一餐保持有主食、有蛋白质、有蔬菜的搭配，口味清淡一些就很好。',
    activitySuggestion: '如果身体允许，饭后慢慢走一走，感觉轻松就好，不必用运动去“抵消”这一餐。',
    disclaimer: DISCLAIMER,
    confidence: 'medium',
    oilCaution: {
      level: 'medium',
      message: '看起来有一些油。若想清淡一点，下一餐可以多选蒸、煮、炖。',
    },
    saltCaution: {
      level: 'medium',
      message: '照片无法判断咸淡，可以留意酱油和盐的使用，按口味适量就好。',
    },
    source: 'mock',
    warnings: [DEMO_WARNING, '油盐提示只参考照片与菜名，无法据此测量实际含量。'],
    timings: {
      aiMs: 700,
      calculationMs: 4,
      totalMs: 860,
      aiAttempts: 1,
    },
  },
  {
    schemaVersion: 2,
    mealName: '番茄炒蛋配米饭',
    foods: [
      {
        id: 'food-1',
        name: '米饭',
        matchedName: '米饭',
        category: 'staple',
        portionG: 150,
        portionRangeG: { min: 120, max: 180 },
        confidence: 'medium',
        dataSource: 'database',
        preparation: 'steamed',
      },
      {
        id: 'food-2',
        name: '番茄炒蛋',
        matchedName: '番茄炒蛋',
        category: 'mixed',
        portionG: 180,
        portionRangeG: { min: 150, max: 220 },
        confidence: 'medium',
        dataSource: 'database',
        preparation: 'stir_fried',
      },
      {
        id: 'food-3',
        name: '清炒绿叶菜',
        matchedName: '清炒绿叶菜',
        category: 'vegetable',
        portionG: 120,
        portionRangeG: { min: 90, max: 150 },
        confidence: 'low',
        dataSource: 'database',
        preparation: 'stir_fried',
      },
    ],
    nutrition: {
      caloriesKcal: { min: 480, max: 650 },
      proteinG: { min: 18, max: 26 },
      fatG: { min: 18, max: 28 },
    },
    assessment: '这顿饭有主食、蔬菜和蛋白质来源，搭配比较完整。看起来有一些油，但照片无法判断实际用油量。',
    suggestions: [
      '这顿饭的蛋白质来源比较充足，下一餐保持适量就好。',
      '蔬菜可以换着颜色吃，深色蔬菜多一些会更好。',
      '炒菜时稍微少放一点油，味道通常也足够。',
    ],
    nextMeal: '下一餐保持有主食、有蛋白质、有蔬菜的搭配，口味清淡一些就很好。',
    activitySuggestion: '如果身体允许，饭后慢慢走一走，感觉轻松就好，不必用运动去“抵消”这一餐。',
    disclaimer: DISCLAIMER,
    confidence: 'medium',
    oilCaution: {
      level: 'medium',
      message: '看起来有一些油。若想清淡一点，下一餐可以多选蒸、煮、炖。',
    },
    saltCaution: {
      level: 'low',
      message: '照片无法测量盐含量，日常烹饪仍建议适量用盐。',
    },
    source: 'mock',
    warnings: [DEMO_WARNING, '油盐提示只参考照片与菜名，无法据此测量实际含量。'],
    timings: {
      aiMs: 760,
      calculationMs: 5,
      totalMs: 920,
      aiAttempts: 1,
    },
  },
  {
    schemaVersion: 2,
    mealName: '清蒸鱼配米饭和青菜',
    foods: [
      {
        id: 'food-1',
        name: '米饭',
        matchedName: '米饭',
        category: 'staple',
        portionG: 150,
        portionRangeG: { min: 120, max: 180 },
        confidence: 'medium',
        dataSource: 'database',
        preparation: 'steamed',
      },
      {
        id: 'food-2',
        name: '清蒸鱼',
        matchedName: '清蒸鱼',
        category: 'fish',
        portionG: 140,
        portionRangeG: { min: 110, max: 170 },
        confidence: 'medium',
        dataSource: 'database',
        preparation: 'steamed',
      },
      {
        id: 'food-3',
        name: '清炒绿叶菜',
        matchedName: '清炒绿叶菜',
        category: 'vegetable',
        portionG: 150,
        portionRangeG: { min: 120, max: 180 },
        confidence: 'medium',
        dataSource: 'database',
        preparation: 'stir_fried',
      },
    ],
    nutrition: {
      caloriesKcal: { min: 390, max: 520 },
      proteinG: { min: 26, max: 34 },
      fatG: { min: 9, max: 16 },
    },
    assessment: '这顿饭有主食、蔬菜和蛋白质来源，搭配比较完整。',
    suggestions: [
      '这顿饭的蛋白质来源比较充足，下一餐保持适量就好。',
      '蔬菜可以换着颜色吃，深色蔬菜多一些会更好。',
    ],
    nextMeal: '下一餐保持有主食、有蛋白质、有蔬菜的搭配，口味清淡一些就很好。',
    activitySuggestion: '如果身体允许，饭后慢慢走一走，感觉轻松就好，不必用运动去“抵消”这一餐。',
    disclaimer: DISCLAIMER,
    confidence: 'medium',
    oilCaution: {
      level: 'low',
      message: '从照片看油腻程度不高；实际用油量无法仅凭照片判断。',
    },
    saltCaution: {
      level: 'low',
      message: '照片无法测量盐含量，日常烹饪仍建议适量用盐。',
    },
    source: 'mock',
    warnings: [DEMO_WARNING, '油盐提示只参考照片与菜名，无法据此测量实际含量。'],
    timings: {
      aiMs: 680,
      calculationMs: 4,
      totalMs: 830,
      aiAttempts: 1,
    },
  },
];

export function buildMockMeal(mealType: MealType): MealRecord {
  const template = MEALS[Math.floor(Math.random() * MEALS.length)];
  const now = new Date();
  // 使用 JSON 深拷贝，兼容不支持 structuredClone 的旧 JSCore；模板只包含 JSON 数据。
  const copy = JSON.parse(JSON.stringify(template)) as typeof template;
  return {
    ...copy,
    id: makeId(),
    mealType,
    localDate: chinaLocalDate(now),
    createdAt: now.toISOString(),
    timings: undefined,
  };
}

export function mockChatReply(message: string): ChatReply {
  const conversationId = 'demo-conversation';
  let text: string;
  if (/蛋白|肉|蛋|豆腐|鱼/.test(message)) {
    text =
      '鸡蛋、豆腐、鱼、瘦肉和牛奶都能提供蛋白质。每餐安排一个手掌大小的蛋白质食物，通常比较容易坚持。下一餐可以选清蒸鱼或豆腐配蔬菜，口味清淡一些也很好。';
  } else if (/油|腻|盐|咸/.test(message)) {
    text =
      '中餐的油盐大多在烹饪时加入，照片很难准确判断。可以先从少放一勺油、少用一点酱油开始，多用蒸、煮、炖，味道通常也不会差。不用一下子改很多，慢慢调整更容易坚持。';
  } else if (/运动|散步|锻炼/.test(message)) {
    text =
      '如果身体允许，饭后慢慢走 10 到 20 分钟就不错，以不觉得勉强为准。运动是为了让身体舒服，不需要拿它去“抵消”某一顿饭。如果有慢性病或行动不便，先问问医生适合什么活动。';
  } else if (/晚饭|晚餐|吃什么/.test(message)) {
    text =
      '晚饭可以按“一份主食 + 一份蛋白质 + 一份蔬菜”来搭，比如米饭、清蒸鱼和炒青菜。若午餐吃得比较油，晚餐就清淡一点；不用刻意不吃主食，七八分饱通常更舒服。';
  } else if (/血压|血糖|怀孕|吃药|孩子|老人/.test(message)) {
    text =
      '这类情况需要结合个人健康状况判断，我只能提供一般饮食信息，不能替代医生或注册营养师的建议。可以带着近期饮食记录咨询专业人员；如果有明显不适，请及时就医。';
  } else {
    text =
      '可以先用一个简单的搭配来判断：主食、蛋白质食物和蔬菜是否都有。今天下一餐补上缺少的一类就好，不需要追求每顿都完美。你也可以告诉我具体吃了什么，我帮你一起看看。';
  }
  return {
    conversationId,
    source: 'mock',
    message: {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      text,
      createdAt: new Date().toISOString(),
      source: 'mock',
    },
  };
}
