/**
 * 前后端共享的数据契约。
 *
 * 重要约束：
 * 1. 模型只负责识别食物与份量，不直接写入最终营养数值。
 * 2. 最终营养区间由服务端食物成分库计算，客户端仅展示。
 * 3. mock 来源必须在 UI 中明确标注，绝不能伪装为真实 AI 结果。
 */

export const SCHEMA_VERSION = 2;

export type ApiErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_INPUT'
  | 'INVALID_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_EXPIRED'
  | 'RECOGNITION_FAILED'
  | 'RECOGNITION_EMPTY'
  | 'AI_TIMEOUT'
  | 'AI_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'NOT_FOUND'
  | 'TTS_UNAVAILABLE'
  | 'TTS_FAILED'
  | 'NETWORK_ERROR'
  | 'CLOUD_NOT_CONFIGURED'
  | 'MOCK_MODE'
  | 'CANCELLED'
  | 'INTERNAL_ERROR';

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  requestId: string;
}

export interface ApiFailure {
  ok: false;
  error: ApiError;
  requestId: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export type AnalysisSource = 'ai' | 'mock';

export const FOOD_CATEGORIES = [
  'staple',
  'vegetable',
  'meat',
  'poultry',
  'fish',
  'egg',
  'soy',
  'soup',
  'fruit',
  'dairy',
  'nuts',
  'pastry',
  'beverage',
  'mixed',
  'other',
] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

export interface NumericRange {
  min: number;
  max: number;
}

export interface IdentifiedFood {
  /** 稳定 ID，仅用于当前餐次编辑。 */
  id: string;
  /** 面向用户显示的名称。 */
  name: string;
  /** 命中的食物成分库标准名称；未命中时为同类替代项。 */
  matchedName: string;
  category: FoodCategory;
  portionG: number;
  portionRangeG: NumericRange;
  confidence: Confidence;
  dataSource: 'database' | 'category_fallback';
  preparation?: string;
  /** 例如“未收录‘莴笋炒山药’，按同类蔬菜估算”。 */
  note?: string;
}

export interface MealNutrition {
  caloriesKcal: NumericRange;
  proteinG: NumericRange;
  fatG: NumericRange;
}

export interface DietaryCaution {
  level: 'low' | 'medium' | 'high' | 'unknown';
  message: string;
}

export interface ServerTimings {
  downloadMs?: number;
  aiMs?: number;
  calculationMs?: number;
  totalMs: number;
  aiAttempts?: number;
}

export interface MealRecord {
  id: string;
  schemaVersion: number;
  mealName: string;
  mealType: MealType;
  /** 中国时区 YYYY-MM-DD。 */
  localDate: string;
  createdAt: string;
  foods: IdentifiedFood[];
  nutrition: MealNutrition;
  assessment: string;
  suggestions: string[];
  nextMeal: string;
  activitySuggestion: string;
  disclaimer: string;
  confidence: Confidence;
  oilCaution: DietaryCaution;
  saltCaution: DietaryCaution;
  source: AnalysisSource;
  warnings: string[];
  timings?: ServerTimings;
}

export interface PrepareUploadInput {
  sizeBytes: number;
  mimeType: string;
}

export interface PrepareUploadResult {
  uploadId: string;
  cloudPath: string;
  expiresAt: string;
}

export interface AnalyzeMealInput {
  uploadId: string;
  /** 由 wx.cloud.uploadFile 返回；服务端会校验其路径与上传票据严格匹配。 */
  fileID: string;
  mealType: MealType;
  requestId: string;
}

export interface FoodCorrection {
  id?: string;
  name: string;
  portionG: number;
}

export interface UpdateMealFoodsInput {
  mealId: string;
  foods: FoodCorrection[];
}

export interface ListMealsInput {
  /** 可选，默认今天；格式 YYYY-MM-DD，最多回看 30 天。 */
  date?: string;
}

export interface ListMealsResult {
  date: string;
  meals: MealRecord[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  source?: AnalysisSource;
}

export interface GetConversationResult {
  conversationId: string;
  messages: ChatMessage[];
}

export interface ChatInput {
  message: string;
  conversationId?: string;
}

export interface ChatReply {
  conversationId: string;
  message: ChatMessage;
  source: AnalysisSource;
}

export interface SpeakMealInput {
  mealId: string;
  speed?: number;
}

export type SpeechLanguage = 'mandarin' | 'cantonese';

export interface SpeechResult {
  audioBase64: string;
  mimeType: 'audio/mpeg';
  voice: SpeechLanguage;
  speed: number;
}

export const AGE_RANGES = ['18-44', '45-59', '60-74', '75+', 'unspecified'] as const;
export type AgeRange = (typeof AGE_RANGES)[number];

export const ACTIVITY_LEVELS = [
  'mostly_sitting',
  'light',
  'moderate',
  'active',
  'unspecified',
] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export interface UserProfile {
  ageRange: AgeRange;
  activityLevel: ActivityLevel;
  goals: string[];
  dietaryPreferences: string[];
  allergies: string;
  /** 明确允许 AI 聊天参考最近饮食记录，默认关闭。 */
  allowDietHistory: boolean;
  updatedAt?: string;
}

export interface UpdateProfileInput {
  ageRange?: AgeRange;
  activityLevel?: ActivityLevel;
  goals?: string[];
  dietaryPreferences?: string[];
  allergies?: string;
  allowDietHistory?: boolean;
}

export interface DeleteAllDataResult {
  deletedMeals: number;
  deletedConversations: number;
  deletedUploads: number;
  /** 原图或上传记录清理失败的数量；失败记录会保留给维护任务重试。 */
  fileDeletionFailures: number;
  complete: boolean;
  userDeleted: boolean;
}

export interface HealthCheckResult {
  ok: boolean;
  aiConfigured: boolean;
  aiMode: AnalysisSource;
  ttsConfigured: boolean;
  serverTime: string;
  schemaVersion: number;
}

export interface AppSettingsLocal {
  speechSpeed: 0.85 | 1 | 1.15;
  hasOnboarded: boolean;
}

export const DEFAULT_PROFILE: UserProfile = {
  ageRange: 'unspecified',
  activityLevel: 'unspecified',
  goals: [],
  dietaryPreferences: [],
  allergies: '',
  allowDietHistory: false,
};

export const DEFAULT_LOCAL_SETTINGS: AppSettingsLocal = {
  speechSpeed: 1,
  hasOnboarded: false,
};

export function isApiSuccess<T>(
  response: ApiResponse<T>,
): response is ApiSuccess<T> {
  return response.ok === true;
}
