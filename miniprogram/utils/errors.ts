import type { ApiError, ApiErrorCode } from '../types/contracts';

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;

  constructor(error: Pick<ApiError, 'code' | 'message' | 'retryable'>) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

export class UserCancelledError extends Error {
  constructor() {
    super('user_cancelled');
    this.name = 'UserCancelledError';
  }
}

export function toApiRequestError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  if (error instanceof UserCancelledError) {
    return new ApiRequestError({
      code: 'CANCELLED',
      message: '已取消。',
      retryable: true,
    });
  }
  if (error instanceof Error) {
    if (/timeout|timed out/i.test(error.message)) {
      return new ApiRequestError({
        code: 'NETWORK_ERROR',
        message: '等待时间有点久，请检查网络后重试。',
        retryable: true,
      });
    }
    if (/network|request:fail|connection|offline/i.test(error.message)) {
      return new ApiRequestError({
        code: 'NETWORK_ERROR',
        message: '网络连接不太稳定，请检查网络后重试。',
        retryable: true,
      });
    }
  }
  return new ApiRequestError({
    code: 'INTERNAL_ERROR',
    message: '暂时遇到了一点问题，请稍后再试。',
    retryable: true,
  });
}

export function canRetry(error: unknown): boolean {
  return error instanceof ApiRequestError ? error.retryable : true;
}

export function userMessage(error: unknown): string {
  return toApiRequestError(error).message;
}
