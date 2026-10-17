import type { MealType } from './contracts';

export interface PendingMeal {
  localPath: string;
  mealType: MealType;
  createdAt: number;
  requestId: string;
  sizeBytes: number;
  mimeType: 'image/jpeg' | 'image/png';
  captureMs: number;
  compressionMs: number;
}
