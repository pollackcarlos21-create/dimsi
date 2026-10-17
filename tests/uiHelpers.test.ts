import { describe, expect, it } from 'vitest';
import { inferMealType } from '../miniprogram/config';
import {
  formatRange,
  formatRelativeDate,
  formatTime,
  greeting,
  MEAL_TYPE_LABELS,
} from '../miniprogram/utils/format';

describe('界面纯函数', () => {
  it('按时间段推断餐次', () => {
    const at = (hour: number) => new Date(2026, 9, 17, hour, 0, 0);
    expect(inferMealType(at(7))).toBe('breakfast');
    expect(inferMealType(at(12))).toBe('lunch');
    expect(inferMealType(at(18))).toBe('dinner');
    expect(inferMealType(at(23))).toBe('snack');
    expect(MEAL_TYPE_LABELS.lunch).toBe('午餐');
  });

  it('日期和区间展示稳定', () => {
    const now = new Date('2026-10-17T04:00:00.000Z');
    expect(formatRelativeDate('2026-10-17', now)).toBe('今天');
    expect(formatRelativeDate('2026-10-16', now)).toBe('昨天');
    expect(formatRelativeDate('2026-10-01', now)).toBe('10月1日');
    expect(formatRange({ min: 600, max: 800 })).toBe('600–800');
    expect(formatRange({ min: 20, max: 20 })).toBe('20');
  });

  it('问候与时间在本地时区可读', () => {
    expect(greeting(new Date(2026, 9, 17, 8, 0, 0))).toBe('早上好');
    expect(formatTime('2026-10-17T04:20:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });
});
