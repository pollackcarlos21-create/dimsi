import { describe, expect, it } from 'vitest';
import { calculateMeal } from '../cloudfunctions/api/src/domain/nutrition';
import { AppError } from '../cloudfunctions/api/src/lib/errors';
import { sampleRecognition } from './fixtures';

describe('营养区间计算', () => {
  it('只使用食物成分库计算营养，不读取模型营养字段', () => {
    const result = calculateMeal(sampleRecognition());
    expect(result.foods).toHaveLength(2);
    expect(result.nutrition.caloriesKcal).toEqual({ min: 300, max: 580 });
    expect(result.nutrition.proteinG).toEqual({ min: 13, max: 29 });
    expect(result.nutrition.fatG).toEqual({ min: 11, max: 27 });
    expect(result.mealName).toBe('青椒肉丝配米饭');
  });

  it('区间是向外取整，避免制造虚假精度', () => {
    const result = calculateMeal(sampleRecognition());
    expect(result.nutrition.caloriesKcal.min % 10).toBe(0);
    expect(result.nutrition.caloriesKcal.max % 10).toBe(0);
    expect(result.nutrition.proteinG.min).toBeLessThanOrEqual(result.nutrition.proteinG.max);
  });

  it('未匹配食物会降低把握并产生说明', () => {
    const result = calculateMeal({
      mealName: '家常菜',
      foods: [
        {
          name: '莴笋炒山药',
          category: 'vegetable',
          portionG: 150,
          portionLowG: 120,
          portionHighG: 180,
          confidence: 'medium',
          preparation: 'stir_fried',
        },
      ],
      oiliness: 'medium',
      saltinessRisk: 'medium',
    });
    expect(result.foods[0].dataSource).toBe('category_fallback');
    expect(result.confidence).toBe('low');
    expect(result.warnings.join('')).toContain('未在精选成分库');
  });

  it('空识别结果会被拒绝', () => {
    expect(() =>
      calculateMeal({
        mealName: '',
        foods: [],
        oiliness: 'unknown',
        saltinessRisk: 'unknown',
      }),
    ).toThrowError(AppError);
    try {
      calculateMeal({
        mealName: '',
        foods: [],
        oiliness: 'unknown',
        saltinessRisk: 'unknown',
      });
    } catch (error) {
      expect((error as AppError).code).toBe('RECOGNITION_EMPTY');
    }
  });

  it('油腻与咸淡判断只来自级别，不声称精确测量', () => {
    const result = calculateMeal({
      ...sampleRecognition(),
      oiliness: 'high',
      saltinessRisk: 'high',
    });
    expect(result.oilCaution.level).toBe('high');
    expect(result.saltCaution.level).toBe('high');
    expect(result.oilCaution.message).toContain('无法');
    expect(result.saltCaution.message).toContain('无法测量');
  });

  it('份量映射到合理的上下限，不会接受异常值', () => {
    const result = calculateMeal({
      mealName: '米饭',
      foods: [
        {
          name: '米饭',
          category: 'staple',
          portionG: 3000,
          portionLowG: 1,
          portionHighG: 5000,
          confidence: 'high',
          preparation: 'steamed',
        },
      ],
      oiliness: 'low',
      saltinessRisk: 'low',
    });
    expect(result.foods[0].portionG).toBe(2000);
    expect(result.foods[0].portionRangeG.min).toBe(1000);
    expect(result.foods[0].portionRangeG.max).toBe(2500);
  });
});
