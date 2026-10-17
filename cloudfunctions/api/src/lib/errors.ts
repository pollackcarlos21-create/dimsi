import type { ApiError, ApiErrorCode } from '../../../../miniprogram/types/contracts';

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHENTICATED: '登录状态无效，请重新打开小程序后再试。',
  INVALID_INPUT: '这次提交的信息不完整，请检查后再试。',
  INVALID_IMAGE: '这张图片无法识别，请换一张清楚的食物照片。',
  IMAGE_TOO_LARGE: '照片有点大，请重新选择或压缩后再试。',
  UPLOAD_NOT_FOUND: '没有找到这张照片，请重新拍一张。',
  UPLOAD_EXPIRED: '照片已过期，请重新拍一张。',
  RECOGNITION_FAILED: '这次没有看清食物，请换一张更清楚的照片。',
  RECOGNITION_EMPTY: '照片里似乎没有识别到食物，可以靠近一点再拍一张。',
  AI_TIMEOUT: '分析花的时间有点久，请稍后重试。',
  AI_UNAVAILABLE: '分析服务暂时不可用，请稍后再试。',
  RATE_LIMITED: '操作有点频繁，请稍等一会儿再试。',
  QUOTA_EXCEEDED: '今天的使用次数已到上限，明天再来看看吧。',
  NOT_FOUND: '没有找到这条记录，它可能已被删除。',
  TTS_UNAVAILABLE: '朗读服务暂未开通，文字建议仍可正常查看。',
  TTS_FAILED: '这次没有生成语音，可以稍后再试。',
  NETWORK_ERROR: '网络连接不太稳定，请检查网络后重试。',
  CLOUD_NOT_CONFIGURED: '云服务尚未配置，请先使用演示模式。',
  MOCK_MODE: '当前为演示模式，没有调用真实分析服务。',
  CANCELLED: '操作已取消。',
  INTERNAL_ERROR: '服务暂时遇到问题，请稍后再试。',
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly publicMessage: string;
  readonly retryable: boolean;
  readonly internalDetail?: string;
  readonly logLevel: 'warn' | 'error';

  constructor(
    code: ApiErrorCode,
    options: {
      message?: string;
      retryable?: boolean;
      internalDetail?: string;
      logLevel?: 'warn' | 'error';
    } = {},
  ) {
    super(options.internalDetail ?? options.message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.publicMessage = options.message ?? DEFAULT_MESSAGES[code];
    this.retryable = options.retryable ?? false;
    this.internalDetail = options.internalDetail;
    this.logLevel = options.logLevel ?? 'warn';
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.publicMessage,
      retryable: this.retryable,
    };
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return new AppError('INTERNAL_ERROR', {
    retryable: true,
    internalDetail:
      error instanceof Error ? `unexpected:${error.name}` : 'unknown_error',
    logLevel: 'error',
  });
}

export function publicError(error: unknown): ApiError {
  return toAppError(error).toApiError();
}
