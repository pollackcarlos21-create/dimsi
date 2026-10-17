import type {
  AppSettingsLocal,
  MealRecord,
  UserProfile,
} from '../types/contracts';
import { DEFAULT_LOCAL_SETTINGS } from '../types/contracts';
import type { PendingMeal } from '../types/client';

const KEYS = {
  pendingMeal: 'zhishi.pendingMeal.v1',
  localSettings: 'zhishi.localSettings.v1',
  localMeals: 'zhishi.demoMeals.v1',
  localProfile: 'zhishi.demoProfile.v1',
  localConversation: 'zhishi.demoConversation.v1',
  timings: 'zhishi.analysisTimings.v1',
  ttsTimings: 'zhishi.ttsTimings.v1',
} as const;

function read<T>(key: string, fallback: T): T {
  try {
    const value = wx.getStorageSync(key);
    return value === '' || value === undefined || value === null ? fallback : (value as T);
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    wx.setStorageSync(key, value);
  } catch {
    // 存储失败不应阻塞主流程；调用方可自行决定是否提示。
  }
}

function remove(key: string): void {
  try {
    wx.removeStorageSync(key);
  } catch {
    // ignore
  }
}

export const storage = {
  read,
  write,
  remove,

  getPendingMeal(): PendingMeal | null {
    return read<PendingMeal | null>(KEYS.pendingMeal, null);
  },
  setPendingMeal(pending: PendingMeal): void {
    write(KEYS.pendingMeal, pending);
  },
  clearPendingMeal(): void {
    remove(KEYS.pendingMeal);
  },

  getLocalSettings(): AppSettingsLocal {
    return {
      ...DEFAULT_LOCAL_SETTINGS,
      ...read<Partial<AppSettingsLocal>>(KEYS.localSettings, {}),
    };
  },
  setLocalSettings(settings: AppSettingsLocal): void {
    write(KEYS.localSettings, settings);
  },

  getDemoMeals(): MealRecord[] {
    return read<MealRecord[]>(KEYS.localMeals, []);
  },
  setDemoMeals(meals: MealRecord[]): void {
    write(KEYS.localMeals, meals.slice(0, 60));
  },

  getDemoProfile(): UserProfile | null {
    return read<UserProfile | null>(KEYS.localProfile, null);
  },
  setDemoProfile(profile: UserProfile): void {
    write(KEYS.localProfile, profile);
  },

  getDemoConversation(): Array<Record<string, unknown>> {
    return read<Array<Record<string, unknown>>>(KEYS.localConversation, []);
  },
  setDemoConversation(messages: Array<Record<string, unknown>>): void {
    write(KEYS.localConversation, messages.slice(-40));
  },

  getTimings<T>(): T[] {
    return read<T[]>(KEYS.timings, []);
  },
  setTimings<T>(records: T[]): void {
    write(KEYS.timings, records.slice(0, 20));
  },

  getTtsTimings<T>(): T[] {
    return read<T[]>(KEYS.ttsTimings, []);
  },
  setTtsTimings<T>(records: T[]): void {
    write(KEYS.ttsTimings, records.slice(0, 20));
  },

  clearDemoData(): void {
    remove(KEYS.localMeals);
    remove(KEYS.localProfile);
    remove(KEYS.localConversation);
    remove(KEYS.timings);
    remove(KEYS.ttsTimings);
    remove(KEYS.pendingMeal);
  },
};
