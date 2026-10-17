import { createHash } from 'node:crypto';
import type {
  AiProvider,
  ChatBundle,
  ChatRequest,
  RecognitionBundle,
  RecognitionResult,
} from '../domain/types';

const MOCK_MEALS: RecognitionResult[] = [
  {
    mealName: '青椒肉丝配米饭',
    foods: [
      {
        name: '米饭',
        category: 'staple',
        portionG: 150,
        portionLowG: 120,
        portionHighG: 180,
        confidence: 'medium',
        preparation: 'steamed',
      },
      {
        name: '青椒肉丝',
        category: 'mixed',
        portionG: 160,
        portionLowG: 130,
        portionHighG: 190,
        confidence: 'medium',
        preparation: 'stir_fried',
      },
    ],
    oiliness: 'medium',
    saltinessRisk: 'medium',
    observation: '米饭和青椒炒肉的常见家常搭配。',
  },
  {
    mealName: '番茄炒蛋配米饭',
    foods: [
      {
        name: '米饭',
        category: 'staple',
        portionG: 150,
        portionLowG: 120,
        portionHighG: 180,
        confidence: 'medium',
        preparation: 'steamed',
      },
      {
        name: '番茄炒蛋',
        category: 'mixed',
        portionG: 180,
        portionLowG: 150,
        portionHighG: 220,
        confidence: 'medium',
        preparation: 'stir_fried',
      },
      {
        name: '清炒绿叶菜',
        category: 'vegetable',
        portionG: 120,
        portionLowG: 90,
        portionHighG: 150,
        confidence: 'low',
        preparation: 'stir_fried',
      },
    ],
    oiliness: 'medium',
    saltinessRisk: 'medium',
    observation: '有蛋、有蔬菜，是常见的家常搭配。',
  },
  {
    mealName: '清蒸鱼配米饭和青菜',
    foods: [
      {
        name: '米饭',
        category: 'staple',
        portionG: 150,
        portionLowG: 120,
        portionHighG: 180,
        confidence: 'medium',
        preparation: 'steamed',
      },
      {
        name: '清蒸鱼',
        category: 'fish',
        portionG: 140,
        portionLowG: 110,
        portionHighG: 170,
        confidence: 'medium',
        preparation: 'steamed',
      },
      {
        name: '清炒绿叶菜',
        category: 'vegetable',
        portionG: 150,
        portionLowG: 120,
        portionHighG: 180,
        confidence: 'medium',
        preparation: 'stir_fried',
      },
    ],
    oiliness: 'low',
    saltinessRisk: 'low',
    observation: '清蒸鱼和绿叶菜，整体做法比较清淡。',
  },
];

function pickMeal(buffer: Buffer): RecognitionResult {
  const digest = createHash('sha256').update(buffer).digest();
  return MOCK_MEALS[digest[0] % MOCK_MEALS.length];
}

function mockChatReply(request: ChatRequest): string {
  const message = request.message;
  if (/蛋白|肉|蛋|豆腐|鱼/.test(message)) {
    return '鸡蛋、豆腐、鱼、瘦肉和牛奶都能提供蛋白质。每餐安排一个手掌大小的蛋白质食物，通常比较容易坚持。下一餐可以选清蒸鱼或豆腐配蔬菜，口味清淡一些也很好。';
  }
  if (/油|腻|盐|咸/.test(message)) {
    return '中餐的油盐大多在烹饪时加入，照片很难准确判断。可以先从少放一勺油、少用一点酱油开始，多用蒸、煮、炖，味道通常也不会差。不用一下子改很多，慢慢调整更容易坚持。';
  }
  if (/运动|散步|锻炼/.test(message)) {
    return '如果身体允许，饭后慢慢走 10 到 20 分钟就不错，以不觉得勉强为准。运动是为了让身体舒服，不需要拿它去“抵消”某一顿饭。如果有慢性病或行动不便，先问问医生适合什么活动。';
  }
  if (/晚饭|晚餐|吃什么/.test(message)) {
    return '晚饭可以按“一份主食 + 一份蛋白质 + 一份蔬菜”来搭，比如米饭、清蒸鱼和炒青菜。若午餐吃得比较油，晚餐就清淡一点；不用刻意不吃主食，七八分饱通常更舒服。';
  }
  if (/孩子|老人|血压|血糖|怀孕|药/.test(message)) {
    return '这类情况需要结合个人健康状况判断，我只能提供一般饮食信息，不能替代医生或注册营养师的建议。可以带着近期饮食记录咨询专业人员；如果有明显不适，请及时就医。';
  }
  return '可以先用一个简单的搭配来判断：主食、蛋白质食物和蔬菜是否都有。今天下一餐补上缺少的一类就好，不需要追求每顿都完美。你也可以告诉我具体吃了什么，我帮你一起看看。';
}

/**
 * 服务端演示模式：只返回固定示例，不读取图片内容。
 * 上层会强制标记 source=mock，UI 也必须显示“演示数据”。
 */
export class MockAiProvider implements AiProvider {
  readonly mode = 'mock' as const;

  async analyzeImage(buffer: Buffer): Promise<RecognitionBundle> {
    return {
      recognition: structuredClone(pickMeal(buffer)),
      source: 'mock',
      attempts: 1,
      aiMs: 0,
      model: 'mock-local',
    };
  }

  async chat(request: ChatRequest): Promise<ChatBundle> {
    return {
      text: mockChatReply(request),
      source: 'mock',
      aiMs: 0,
    };
  }
}

export function createAiProvider(
  aiMockMode: boolean,
  deepseek: AiProvider,
): AiProvider {
  return aiMockMode ? new MockAiProvider() : deepseek;
}
