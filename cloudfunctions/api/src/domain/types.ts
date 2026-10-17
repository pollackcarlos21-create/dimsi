import type {
  AnalysisSource,
  Confidence,
  DietaryCaution,
  FoodCategory,
  IdentifiedFood,
  MealNutrition,
  MealRecord,
  MealType,
  ServerTimings,
  SpeechLanguage,
  UserProfile,
} from '../../../../miniprogram/types/contracts';
import type { AppConfig } from '../lib/config';
import type { Logger } from '../lib/logger';

export type Oiliness = 'low' | 'medium' | 'high' | 'unknown';
export type SaltinessRisk = 'low' | 'medium' | 'high' | 'unknown';
export type Preparation =
  | 'steamed'
  | 'boiled'
  | 'stir_fried'
  | 'deep_fried'
  | 'braised'
  | 'cold'
  | 'grilled'
  | 'raw'
  | 'packaged'
  | 'unknown';

export interface RecognitionFood {
  name: string;
  category: FoodCategory;
  portionG: number;
  portionLowG: number;
  portionHighG: number;
  confidence: Confidence;
  preparation: Preparation;
  visualNote?: string;
}

export interface RecognitionResult {
  mealName: string;
  foods: RecognitionFood[];
  oiliness: Oiliness;
  saltinessRisk: SaltinessRisk;
  observation?: string;
}

export interface RecognitionBundle {
  recognition: RecognitionResult;
  source: AnalysisSource;
  attempts: number;
  aiMs: number;
  model: string;
}

export interface ChatRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  mealContext?: string;
  profile?: UserProfile;
}

export interface ChatBundle {
  text: string;
  source: AnalysisSource;
  aiMs: number;
}

export interface AiProvider {
  readonly mode: AnalysisSource;
  analyzeImage(buffer: Buffer, mimeType: string): Promise<RecognitionBundle>;
  chat(request: ChatRequest): Promise<ChatBundle>;
}

export interface TtsProvider {
  readonly configured: boolean;
  synthesize(
    text: string,
    options: { language: SpeechLanguage; speed: number },
  ): Promise<{ audioBase64: string; mimeType: 'audio/mpeg'; voice: SpeechLanguage }>;
}

export interface UploadRecord {
  id: string;
  ownerOpenId: string;
  cloudPath: string;
  declaredMimeType: string;
  status: 'pending' | 'processing' | 'used';
  createdAt: string;
  expiresAt: string;
  processingAt?: string;
  usedAt?: string;
  mealId?: string;
  fileID?: string;
  imageDeletedAt?: string;
}

export interface MealDocument {
  id: string;
  ownerOpenId: string;
  record: MealRecord;
  uploadId?: string;
  imageDeletedAt?: string;
}

export interface ConversationDocument {
  id: string;
  ownerOpenId: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    text: string;
    createdAt: string;
    source?: AnalysisSource;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface UserDocument {
  id: string;
  ownerOpenId: string;
  profile: UserProfile;
  createdAt: string;
  updatedAt: string;
}

export type UsageBucket = 'upload' | 'analysis' | 'chat' | 'tts';

export interface UsageResult {
  allowed: boolean;
  used: number;
  limit: number;
}

export interface AppRepository {
  createUpload(record: UploadRecord): Promise<void>;
  getUpload(ownerOpenId: string, uploadId: string): Promise<UploadRecord | null>;
  countActiveUploads(ownerOpenId: string, nowIso: string): Promise<number>;
  listAllUploads(ownerOpenId: string): Promise<UploadRecord[]>;
  attachUploadFile(ownerOpenId: string, uploadId: string, fileID: string): Promise<void>;
  claimUpload(
    ownerOpenId: string,
    uploadId: string,
    claimedAtIso: string,
    staleBeforeIso: string,
  ): Promise<'claimed' | 'busy' | 'used' | 'missing'>;
  releaseUploadClaim(
    ownerOpenId: string,
    uploadId: string,
    claimedAtIso: string,
  ): Promise<void>;
  markUploadUsed(
    ownerOpenId: string,
    uploadId: string,
    mealId: string,
    fileID: string,
    usedAt: string,
  ): Promise<void>;
  markUploadImageDeleted(ownerOpenId: string, uploadId: string, deletedAt: string): Promise<void>;
  getExpiredUploads(limit: number): Promise<UploadRecord[]>;
  deleteUpload(ownerOpenId: string, uploadId: string): Promise<void>;

  createMeal(ownerOpenId: string, meal: MealRecord, uploadId?: string): Promise<void>;
  getMeal(ownerOpenId: string, mealId: string): Promise<MealDocument | null>;
  getMealByUploadId(ownerOpenId: string, uploadId: string): Promise<MealDocument | null>;
  listMeals(ownerOpenId: string, localDate: string, limit: number): Promise<MealDocument[]>;
  updateMeal(ownerOpenId: string, mealId: string, record: MealRecord): Promise<boolean>;
  deleteMeal(ownerOpenId: string, mealId: string): Promise<boolean>;

  getUser(ownerOpenId: string): Promise<UserDocument | null>;
  upsertUser(ownerOpenId: string, profile: UserProfile): Promise<UserDocument>;
  deleteUser(ownerOpenId: string): Promise<boolean>;

  getConversation(ownerOpenId: string): Promise<ConversationDocument | null>;
  saveConversation(document: ConversationDocument): Promise<void>;

  consumeUsage(
    ownerOpenId: string,
    bucket: UsageBucket,
    limit: number,
    now: Date,
  ): Promise<UsageResult>;

  deleteAllForUser(ownerOpenId: string): Promise<{
    deletedMeals: number;
    deletedConversations: number;
    userDeleted: boolean;
  }>;
}

export interface StorageProvider {
  downloadFile(fileID: string): Promise<Buffer>;
  deleteFile(fileID: string): Promise<void>;
}

export interface RateLimiter {
  allow(ownerOpenId: string, action: string, minimumIntervalMs: number): boolean;
}

export interface AppDependencies {
  config: AppConfig;
  repo: AppRepository;
  storage: StorageProvider;
  ai: AiProvider;
  tts: TtsProvider;
  logger: Logger;
  rateLimiter: RateLimiter;
  now: () => Date;
}

export interface HandlerContext {
  openid: string;
  requestId: string;
  action: string;
  payload: unknown;
  deps: AppDependencies;
}

export interface MealCalculationResult {
  mealName: string;
  foods: IdentifiedFood[];
  nutrition: MealNutrition;
  confidence: Confidence;
  oilCaution: DietaryCaution;
  saltCaution: DietaryCaution;
  assessment: string;
  suggestions: string[];
  nextMeal: string;
  activitySuggestion: string;
  disclaimer: string;
  warnings: string[];
  categoryCounts: Partial<Record<FoodCategory, number>>;
}

export interface AnalysisResultData {
  meal: MealRecord;
  timings: ServerTimings;
}

export type { MealType };
