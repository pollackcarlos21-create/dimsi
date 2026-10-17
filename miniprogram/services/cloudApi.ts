import { appConfig } from '../config';
import type {
  AnalyzeMealInput,
  ApiResponse,
  ChatInput,
  ChatReply,
  DeleteAllDataResult,
  GetConversationResult,
  HealthCheckResult,
  ListMealsResult,
  MealRecord,
  PrepareUploadInput,
  PrepareUploadResult,
  SpeakMealInput,
  SpeechResult,
  UpdateMealFoodsInput,
  UpdateProfileInput,
  UserProfile,
} from '../types/contracts';
import { ApiRequestError, toApiRequestError } from '../utils/errors';
import type {
  AnalyzeMealOptions,
  ChatRequestInput,
  MealUploadTicket,
  NutritionApi,
} from './types';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ApiRequestError({
          code: 'NETWORK_ERROR',
          message: '等待时间有点久，请检查网络后重试。',
          retryable: true,
        }),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function assertCloudReady(): void {
  const app = getApp<IAppOption>();
  if (!app.globalData.cloudReady) {
    throw new ApiRequestError({
      code: 'CLOUD_NOT_CONFIGURED',
      message:
        app.globalData.cloudInitError ||
        '云服务尚未就绪。开发者需要先填写 CloudBase 环境 ID 并部署云函数。',
      retryable: true,
    });
  }
}

async function callCloud<T>(
  action: string,
  payload: unknown = {},
  timeoutMs = 30_000,
): Promise<T> {
  assertCloudReady();
  let result: Awaited<ReturnType<typeof wx.cloud.callFunction>>;
  try {
    result = await withTimeout(
      wx.cloud.callFunction({
        name: appConfig.apiFunctionName,
        data: { action, payload },
      }),
      timeoutMs,
    );
  } catch (error) {
    throw toApiRequestError(error);
  }

  const body = result?.result as ApiResponse<T> | undefined;
  if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean') {
    throw new ApiRequestError({
      code: 'CLOUD_NOT_CONFIGURED',
      message: '没有收到云函数的有效响应，请确认云函数已部署并配置环境。',
      retryable: true,
    });
  }
  if (!body.ok) {
    throw new ApiRequestError({
      code: body.error?.code ?? 'INTERNAL_ERROR',
      message: body.error?.message ?? '服务暂时遇到问题，请稍后再试。',
      retryable: body.error?.retryable ?? true,
    });
  }
  return body.data;
}

async function uploadToCloud(
  filePath: string,
  cloudPath: string,
): Promise<string> {
  try {
    const result = await withTimeout(
      wx.cloud.uploadFile({ cloudPath, filePath }),
      60_000,
    );
    if (!result.fileID) throw new Error('upload_missing_file_id');
    return result.fileID;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError({
      code: 'NETWORK_ERROR',
      message: '照片上传没有完成，请检查网络后再试。',
      retryable: true,
    });
  }
}

export class CloudApi implements NutritionApi {
  readonly mode = 'cloud' as const;

  async prepareMealImage(image: {
    path: string;
    sizeBytes: number;
    mimeType: 'image/jpeg' | 'image/png';
  }): Promise<MealUploadTicket> {
    const payload: PrepareUploadInput = {
      sizeBytes: image.sizeBytes,
      mimeType: image.mimeType,
    };
    const prepared = await callCloud<PrepareUploadResult>('prepareUpload', payload, 20_000);
    const uploadStartedAt = Date.now();
    const fileID = await uploadToCloud(image.path, prepared.cloudPath);
    const uploadMs = Date.now() - uploadStartedAt;
    try {
      // 登记 fileID 以便清理“已上传但未分析”的残留图片；
      // analyzeMeal 仍会补登记，因此这里失败不阻塞用户。
      await callCloud<{ registered: true }>(
        'confirmUpload',
        { uploadId: prepared.uploadId, fileID },
        10_000,
      );
    } catch {
      // 分析调用会再次校验并登记 fileID。
    }
    return {
      localPath: image.path,
      uploadId: prepared.uploadId,
      fileID,
      cloudPath: prepared.cloudPath,
      uploadMs,
    };
  }

  async analyzeMeal(
    ticket: MealUploadTicket,
    options: AnalyzeMealOptions,
  ): Promise<MealRecord> {
    if (!ticket.uploadId || !ticket.fileID) {
      throw new ApiRequestError({
        code: 'UPLOAD_NOT_FOUND',
        message: '照片上传凭证不完整，请重新拍一张。',
        retryable: false,
      });
    }
    const payload: AnalyzeMealInput = {
      uploadId: ticket.uploadId,
      fileID: ticket.fileID,
      mealType: options.mealType,
      requestId: options.requestId,
    };
    return callCloud<MealRecord>('analyzeMeal', payload, appConfig.analysisTimeoutMs);
  }

  async getMeal(mealId: string): Promise<MealRecord> {
    return callCloud<MealRecord>('getMeal', { mealId });
  }

  async listMeals(date?: string): Promise<ListMealsResult> {
    return callCloud<ListMealsResult>('listMeals', date ? { date } : {});
  }

  async updateMealFoods(
    mealId: string,
    foods: Array<{ id?: string; name: string; portionG: number }>,
  ): Promise<MealRecord> {
    const payload: UpdateMealFoodsInput = { mealId, foods };
    return callCloud<MealRecord>('updateMealFoods', payload);
  }

  async deleteMeal(mealId: string): Promise<{ deleted: true }> {
    return callCloud<{ deleted: true }>('deleteMeal', { mealId });
  }

  async getConversation(): Promise<GetConversationResult> {
    return callCloud<GetConversationResult>('getConversation', {});
  }

  async chat(input: ChatRequestInput): Promise<ChatReply> {
    const payload: ChatInput = {
      message: input.message,
      conversationId: input.conversationId || undefined,
    };
    return callCloud<ChatReply>('chat', payload, 45_000);
  }

  async speakMeal(mealId: string, speed = 1): Promise<SpeechResult> {
    const payload: SpeakMealInput = { mealId, speed };
    return callCloud<SpeechResult>('speakMeal', payload, 40_000);
  }

  async getProfile(): Promise<UserProfile> {
    return callCloud<UserProfile>('getProfile', {});
  }

  async updateProfile(input: UpdateProfileInput): Promise<UserProfile> {
    return callCloud<UserProfile>('updateProfile', input);
  }

  async deleteAllData(): Promise<DeleteAllDataResult> {
    return callCloud<DeleteAllDataResult>('deleteAllData', {}, 30_000);
  }

  async getHealth(): Promise<HealthCheckResult> {
    return callCloud<HealthCheckResult>('health', {});
  }
}
