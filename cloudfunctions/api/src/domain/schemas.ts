import { z } from 'zod';
import {
  ACTIVITY_LEVELS,
  AGE_RANGES,
  MEAL_TYPES,
} from '../../../../miniprogram/types/contracts';

export const GOAL_OPTIONS = ['吃够蛋白质', '多吃蔬菜', '少油少盐', '规律吃饭', '保持体重'] as const;
export const PREFERENCE_OPTIONS = ['清淡', '少油', '少盐', '不吃辣', '素食', '控糖'] as const;

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const foodIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const fileIdSchema = z.string().min(10).max(512).startsWith('cloud://');
const shortText = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max));

export const prepareUploadSchema = z.object({
  sizeBytes: z.number().int().min(512).max(10 * 1024 * 1024),
  mimeType: z.enum(['image/jpeg', 'image/png']),
});

export const analyzeMealSchema = z.object({
  uploadId: idSchema,
  fileID: fileIdSchema,
  mealType: z.enum(MEAL_TYPES),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export const confirmUploadSchema = z.object({
  uploadId: idSchema,
  fileID: fileIdSchema,
});

export const getMealSchema = z.object({
  mealId: idSchema,
});

export const listMealsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateMealFoodsSchema = z.object({
  mealId: idSchema,
  foods: z
    .array(
      z.object({
        id: foodIdSchema.optional(),
        name: z.string().trim().min(1).max(30),
        portionG: z.coerce.number().finite().min(5).max(2000),
      }),
    )
    .min(1)
    .max(12),
});

export const chatSchema = z.object({
  message: z
    .string()
    .transform((value) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim())
    .pipe(z.string().min(1).max(500)),
  conversationId: idSchema.optional(),
});

export const speakMealSchema = z.object({
  mealId: idSchema,
  speed: z.coerce.number().min(0.85).max(1.15).optional(),
});

export const updateProfileSchema = z
  .object({
    ageRange: z.enum(AGE_RANGES).optional(),
    activityLevel: z.enum(ACTIVITY_LEVELS).optional(),
    goals: z.array(z.enum(GOAL_OPTIONS)).max(5).optional(),
    dietaryPreferences: z.array(z.enum(PREFERENCE_OPTIONS)).max(6).optional(),
    allergies: shortText(80).optional(),
    allowDietHistory: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'empty_profile_patch',
  });

export const emptySchema = z.object({}).optional().default({});

export const cleanupExpiredSchema = z.object({
  secret: z.string().min(8).max(128),
  limit: z.number().int().min(1).max(100).optional(),
});

export function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  return schema.parse(payload ?? {});
}
