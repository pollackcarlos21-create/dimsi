import { z } from 'zod';
import type { AppConfig } from '../lib/config';
import { AppError } from '../lib/errors';
import { postJson, ProviderHttpError, ProviderTimeoutError } from '../lib/http';
import { parseRecognitionContent, RecognitionParseError } from '../domain/recognition';
import type {
  AiProvider,
  ChatBundle,
  ChatRequest,
  RecognitionBundle,
} from '../domain/types';
import {
  RECOGNITION_REPAIR_HINT,
  CHAT_SYSTEM_PROMPT,
  RECOGNITION_SYSTEM_PROMPT,
} from './prompts';

const ChatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
        }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

function cleanReply(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, 900);
}

function profileContext(request: ChatRequest): string {
  if (!request.profile) return '';
  const parts: string[] = [];
  if (request.profile.ageRange !== 'unspecified') parts.push(`年龄段：${request.profile.ageRange}`);
  if (request.profile.activityLevel !== 'unspecified') {
    parts.push(`活动水平：${request.profile.activityLevel}`);
  }
  if (request.profile.goals.length > 0) parts.push(`饮食目标：${request.profile.goals.join('、')}`);
  if (request.profile.dietaryPreferences.length > 0) {
    parts.push(`饮食偏好：${request.profile.dietaryPreferences.join('、')}`);
  }
  if (request.profile.allergies.trim()) parts.push(`用户填写的食物过敏：${request.profile.allergies.trim()}`);
  return parts.length > 0 ? `用户可选资料（仅用于一般性建议）：\n${parts.join('\n')}` : '';
}

export function buildChatMessages(request: ChatRequest): ChatMessage[] {
  const contextParts = [profileContext(request)];
  if (request.mealContext && request.profile?.allowDietHistory) {
    contextParts.push(`用户明确允许参考的最近饮食摘要：\n${request.mealContext}`);
  }
  const systemContent = contextParts.filter(Boolean).join('\n\n');
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemContent
        ? `${CHAT_SYSTEM_PROMPT}\n\n${systemContent}`
        : CHAT_SYSTEM_PROMPT,
    },
  ];
  for (const item of request.history.slice(-10)) {
    messages.push({
      role: item.role,
      content: item.text.slice(0, 600),
    });
  }
  messages.push({ role: 'user', content: request.message });
  return messages;
}

export class DeepSeekProvider implements AiProvider {
  readonly mode = 'ai' as const;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async analyzeImage(buffer: Buffer, mimeType: string): Promise<RecognitionBundle> {
    const startedAt = Date.now();
    const deadline = startedAt + this.config.aiTimeoutMs;
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    let lastParseError: string | undefined;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs < 1000) {
        throw new AppError('AI_TIMEOUT', {
          retryable: true,
          internalDetail: 'deepseek_total_deadline_exceeded',
        });
      }
      const userText =
        attempt === 1
          ? '请识别这张照片中的一餐，严格按约定 JSON 输出。'
          : `${RECOGNITION_REPAIR_HINT}\n\n请识别这张照片中的一餐。`;
      const content = await this.complete(
        [
          { role: 'system', content: RECOGNITION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              {
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'auto' },
              },
            ],
          },
        ],
        {
          maxTokens: 1400,
          temperature: 0.1,
          jsonMode: true,
          timeoutMs: Math.min(remainingMs, this.config.aiTimeoutMs),
        },
      );

      try {
        const recognition = parseRecognitionContent(content);
        return {
          recognition,
          source: 'ai',
          attempts: attempt,
          aiMs: Date.now() - startedAt,
          model: this.config.deepseekModel,
        };
      } catch (error) {
        if (!(error instanceof RecognitionParseError)) throw error;
        lastParseError = error.message;
      }
    }

    throw new AppError('RECOGNITION_FAILED', {
      message: '这次没能稳定识别食物，请换一张更清楚的照片，或调整角度再试。',
      retryable: true,
      internalDetail: `recognition_parse_failed:${lastParseError ?? 'unknown'}`,
    });
  }

  async chat(request: ChatRequest): Promise<ChatBundle> {
    const startedAt = Date.now();
    const messages = buildChatMessages(request);
    const content = await this.complete(messages, {
      maxTokens: 700,
      temperature: 0.45,
      jsonMode: false,
      timeoutMs: this.config.aiTimeoutMs,
    });
    const text = cleanReply(content);
    if (!text) {
      throw new AppError('AI_UNAVAILABLE', {
        message: '助手这次没有回复，请稍后再试。',
        retryable: true,
        internalDetail: 'empty_chat_completion',
      });
    }
    return { text, source: 'ai', aiMs: Date.now() - startedAt };
  }

  private async complete(
    messages: ChatMessage[],
    options: {
      maxTokens: number;
      temperature: number;
      jsonMode: boolean;
      timeoutMs: number;
    },
  ): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.config.deepseekModel,
      messages,
      stream: false,
      // 非思考模式：降低照片分析的首字/总延迟与 token 成本；
      // JSON 结构由 response_format 与提示词共同约束。
      thinking: { type: 'disabled' },
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };
    if (options.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    let raw: string;
    try {
      raw = await postJson({
        url: `${this.config.deepseekBaseUrl}/chat/completions`,
        body,
        headers: {
          Authorization: `Bearer ${this.config.deepseekApiKey}`,
        },
        timeoutMs: options.timeoutMs,
        maxResponseChars: 3 * 1024 * 1024,
        fetchImpl: this.fetchImpl,
      });
    } catch (error) {
      if (error instanceof ProviderTimeoutError) {
        throw new AppError('AI_TIMEOUT', {
          retryable: true,
          internalDetail: 'deepseek_timeout',
        });
      }
      if (error instanceof ProviderHttpError) {
        throw new AppError('AI_UNAVAILABLE', {
          message: error.status === 429 ? '现在分析的人有点多，请稍后再试。' : undefined,
          retryable: error.retryable,
          internalDetail: `deepseek_http_${error.status}`,
          logLevel: 'error',
        });
      }
      throw error;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      throw new AppError('AI_UNAVAILABLE', {
        retryable: true,
        internalDetail: 'deepseek_invalid_envelope',
      });
    }

    const parsed = ChatCompletionSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new AppError('AI_UNAVAILABLE', {
        retryable: true,
        internalDetail: 'deepseek_unexpected_response',
      });
    }
    const choice = parsed.data.choices[0];
    if (choice.finish_reason === 'length') {
      if (options.jsonMode) {
        throw new AppError('RECOGNITION_FAILED', {
          retryable: true,
          internalDetail: 'deepseek_finish_length',
        });
      }
    }
    const content = choice.message.content?.trim();
    if (!content) {
      throw new AppError('AI_UNAVAILABLE', {
        retryable: true,
        internalDetail: 'deepseek_empty_content',
      });
    }
    return content;
  }
}
