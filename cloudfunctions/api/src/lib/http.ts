import { AppError } from './errors';

export interface PostJsonOptions {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  timeoutMs: number;
  maxResponseChars?: number;
  fetchImpl?: typeof fetch;
}

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`provider_http_${status}`);
    this.name = 'ProviderHttpError';
  }
}

export class ProviderTimeoutError extends Error {
  constructor() {
    super('provider_timeout');
    this.name = 'ProviderTimeoutError';
  }
}

export async function postJson(options: PostJsonOptions): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetchImpl(options.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });

    const text = await response.text();
    const maxChars = options.maxResponseChars ?? 8 * 1024 * 1024;
    if (text.length > maxChars) {
      throw new AppError('INTERNAL_ERROR', {
        internalDetail: 'provider_response_too_large',
        retryable: false,
      });
    }
    if (!response.ok) {
      throw new ProviderHttpError(response.status, response.status >= 500 || response.status === 429);
    }
    return text;
  } catch (error) {
    if (error instanceof AppError || error instanceof ProviderHttpError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderTimeoutError();
    }
    throw new ProviderHttpError(0, true);
  } finally {
    clearTimeout(timer);
  }
}
