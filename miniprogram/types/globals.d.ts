import type { PendingMeal } from './client';

declare global {
  interface IAppOption {
    globalData: {
      cloudReady: boolean;
      cloudInitError: string;
      pendingMeal?: PendingMeal;
    };
  }
}

export {};
