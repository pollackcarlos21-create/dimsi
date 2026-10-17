import { describe, expect, it } from 'vitest';
import {
  parseRecognitionContent,
  RecognitionParseError,
} from '../cloudfunctions/api/src/domain/recognition';

const valid = {
  meal_name: '青椒肉丝配米饭',
  foods: [
    {
      name: '米饭',
      category: 'staple',
      portion_g: 150,
      portion_low_g: 120,
      portion_high_g: 180,
      confidence: 'medium',
      preparation: 'steamed',
    },
    {
      name: '青椒肉丝',
      category: 'mixed',
      portion_g: 160,
      portion_low_g: 130,
      portion_high_g: 190,
      confidence: 'medium',
      preparation: 'stir_fried',
    },
  ],
  oiliness: 'medium',
  saltiness_risk: 'medium',
  observation: '两盘家常菜。',
};

describe('模型输出解析与校验', () => {
  it('接受纯 JSON 与 Markdown 代码围栏', () => {
    const result = parseRecognitionContent(JSON.stringify(valid));
    expect(result.mealName).toBe('青椒肉丝配米饭');
    expect(result.foods).toHaveLength(2);
    const fenced = parseRecognitionContent('```json\n' + JSON.stringify(valid) + '\n```');
    expect(fenced.foods[0].name).toBe('米饭');
  });

  it('忽略模型可能附带的营养字段', () => {
    const result = parseRecognitionContent(
      JSON.stringify({
        ...valid,
        nutrition: { calories_kcal: 100 },
        foods: [{ ...valid.foods[0], calories: 9999 }],
      }),
    );
    expect(result).toHaveProperty('foods');
    expect(result).not.toHaveProperty('nutrition');
    expect(result.foods[0]).not.toHaveProperty('calories');
  });

  it('缺少食物时拒绝输出', () => {
    expect(() =>
      parseRecognitionContent(JSON.stringify({ ...valid, foods: [] })),
    ).toThrowError(RecognitionParseError);
  });

  it('非法类别与做法会降级为 other/unknown', () => {
    const result = parseRecognitionContent(
      JSON.stringify({
        ...valid,
        foods: [{ ...valid.foods[0], category: 'dessert', preparation: 'boiled_forever' }],
      }),
    );
    expect(result.foods[0].category).toBe('other');
    expect(result.foods[0].preparation).toBe('unknown');
  });

  it('字符串数字被谨慎转换，异常份量被限制', () => {
    const result = parseRecognitionContent(
      JSON.stringify({
        ...valid,
        foods: [
          {
            ...valid.foods[0],
            portion_g: '400',
            portion_low_g: '1',
            portion_high_g: '9999',
          },
        ],
      }),
    );
    expect(result.foods[0].portionG).toBe(400);
    expect(result.foods[0].portionLowG).toBeGreaterThanOrEqual(200);
    expect(result.foods[0].portionHighG).toBeLessThanOrEqual(600);
  });

  it('无效 JSON 或缺少对象会被拒绝', () => {
    expect(() => parseRecognitionContent('不是 JSON')).toThrowError(RecognitionParseError);
    expect(() => parseRecognitionContent('[]')).toThrowError(RecognitionParseError);
  });
});
