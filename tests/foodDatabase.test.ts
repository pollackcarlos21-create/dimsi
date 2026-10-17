import { describe, expect, it } from 'vitest';
import {
  assertFoodDatabaseIntegrity,
  foodDatabase,
  normalizeFoodName,
} from '../cloudfunctions/api/src/domain/foodDatabase';

describe('精选食物成分库', () => {
  it('数据区间、ID 与别名完整', () => {
    expect(assertFoodDatabaseIntegrity()).toEqual([]);
  });

  it('可命中常见中式菜名与同义词', () => {
    expect(foodDatabase.resolve('白米饭', 'staple').matchedName).toBe('米饭');
    expect(foodDatabase.resolve('西红柿炒鸡蛋', 'mixed').matchedName).toBe('番茄炒蛋');
    expect(foodDatabase.resolve('青椒炒肉丝', 'mixed').matchedName).toBe('青椒肉丝');
  });

  it('未收录食物使用同类范围并留下透明说明', () => {
    const resolved = foodDatabase.resolve('莴笋炒山药', 'vegetable');
    expect(resolved.dataSource).toBe('category_fallback');
    expect(resolved.category).toBe('vegetable');
    expect(resolved.note).toContain('未在精选成分库');
  });

  it('避免把“鸡蛋汤”错配成“鸡蛋”', () => {
    const resolved = foodDatabase.resolve('鸡蛋汤', 'soup');
    expect(resolved.category).toBe('soup');
    expect(resolved.dataSource).toBe('category_fallback');
  });

  it('规范化会处理全角字符、空格与括号', () => {
    expect(normalizeFoodName(' 米饭（大碗） ')).toBe('米饭');
  });
});
