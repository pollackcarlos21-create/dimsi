import type {
  ChatMessage,
  ChatReply,
  DeleteAllDataResult,
  GetConversationResult,
  HealthCheckResult,
  ListMealsResult,
  MealRecord,
  MealType,
  PrepareUploadResult,
  SpeechResult,
  UpdateProfileInput,
  UserProfile,
} from '../types/contracts';
import type { PreparedImage } from '../utils/image';

export interface MealUploadTicket {
  localPath?: string;
  uploadId?: string;
  fileID?: string;
  cloudPath?: string;
  /** 客户端上传阶段耗时（毫秒），用于诊断。 */
  uploadMs?: number;
}

export interface AnalyzeMealOptions {
  mealType: MealType;
  requestId: string;
}

export interface ChatRequestInput {
  message: string;
  conversationId?: string;
}

export interface NutritionApi {
  readonly mode: 'cloud' | 'local_mock';

  prepareMealImage(
    image: Pick<PreparedImage, 'path' | 'sizeBytes' | 'mimeType'>,
  ): Promise<MealUploadTicket>;
  analyzeMeal(ticket: MealUploadTicket, options: AnalyzeMealOptions): Promise<MealRecord>;
  getMeal(mealId: string): Promise<MealRecord>;
  listMeals(date?: string): Promise<ListMealsResult>;
  updateMealFoods(
    mealId: string,
    foods: Array<{ id?: string; name: string; portionG: number }>,
  ): Promise<MealRecord>;
  deleteMeal(mealId: string): Promise<{ deleted: true }>;

  getConversation(): Promise<GetConversationResult>;
  chat(input: ChatRequestInput): Promise<ChatReply>;
  speakMeal(mealId: string, speed?: number): Promise<SpeechResult>;

  getProfile(): Promise<UserProfile>;
  updateProfile(input: UpdateProfileInput): Promise<UserProfile>;
  deleteAllData(): Promise<DeleteAllDataResult>;
  getHealth(): Promise<HealthCheckResult>;
}

export type { PrepareUploadResult, ChatMessage };
