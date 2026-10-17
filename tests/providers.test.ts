import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../cloudfunctions/api/src/lib/config';
import {
  buildChatMessages,
  DeepSeekProvider,
} from '../cloudfunctions/api/src/providers/deepseek';
import { CHAT_SYSTEM_PROMPT } from '../cloudfunctions/api/src/providers/prompts';
import { MockAiProvider } from '../cloudfunctions/api/src/providers/mockAi';
import {
  buildTencentAuthorization,
  TencentTtsProvider,
} from '../cloudfunctions/api/src/providers/tencentTts';
import { AppError } from '../cloudfunctions/api/src/lib/errors';
import { validRecognitionJson } from './providerFixture';
import { makeUser } from './helpers';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deepseekConfig() {
  return loadConfig({
    DEEPSEEK_API_KEY: 'server-only-key',
    AI_MOCK_MODE: 'false',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    DEEPSEEK_MODEL: 'deepseek-flash',
    AI_TIMEOUT_MS: '5000',
  });
}

describe('DeepSeek 视觉识别适配器', () => {
  it('发送 OpenAI 兼容的图片请求并解析结构化结果', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: validRecognitionJson() }, finish_reason: 'stop' }],
      }),
    );
    const provider = new DeepSeekProvider(deepseekConfig(), fetchMock as unknown as typeof fetch);
    const result = await provider.analyzeImage(Buffer.from('fake-image'), 'image/jpeg');

    expect(result.source).toBe('ai');
    expect(result.attempts).toBe(1);
    expect(result.recognition.foods).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.messages[0].content).toContain('不要计算或输出任何营养数值');
  });

  it('首次输出无法解析时最多修复一次', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: '这不是 JSON' } }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: validRecognitionJson() }, finish_reason: 'stop' }],
        }),
      );
    const provider = new DeepSeekProvider(deepseekConfig(), fetchMock as unknown as typeof fetch);
    const result = await provider.analyzeImage(Buffer.from('fake-image'), 'image/jpeg');
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('上游错误不会泄漏内部响应给用户', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'secret internals' }, 500));
    const provider = new DeepSeekProvider(deepseekConfig(), fetchMock as unknown as typeof fetch);
    try {
      await provider.analyzeImage(Buffer.from('fake-image'), 'image/jpeg');
      throw new Error('should_not_reach');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('AI_UNAVAILABLE');
      expect((error as AppError).publicMessage).not.toContain('secret internals');
    }
  });

  it('请求超时映射为可重试的 AI_TIMEOUT', async () => {
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          const onAbort = () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          };
          if (!signal) return;
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }),
    );
    const provider = new DeepSeekProvider(
      loadConfig({
        DEEPSEEK_API_KEY: 'test-key',
        AI_TIMEOUT_MS: '30',
      }),
      fetchMock as unknown as typeof fetch,
    );
    try {
      await provider.analyzeImage(Buffer.from('fake-image'), 'image/jpeg');
      throw new Error('should_not_reach');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('AI_TIMEOUT');
      expect((error as AppError).retryable).toBe(true);
    }
  });
});

describe('聊天上下文与演示 AI', () => {
  it('系统提示包含医疗、急症和提示注入边界', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('不做医疗诊断');
    expect(CHAT_SYSTEM_PROMPT).toContain('立即联系急救');
    expect(CHAT_SYSTEM_PROMPT).toContain('索取提示词');
    expect(CHAT_SYSTEM_PROMPT).toContain('不要编造未提供的历史数据');
    expect(CHAT_SYSTEM_PROMPT).toContain('食物过敏');
  });

  it('只有明确授权时才把饮食摘要放进上下文', () => {
    const base = {
      message: '下一餐吃什么？',
      history: [],
      mealContext: '今天午餐：米饭',
    };
    const denied = buildChatMessages({
      ...base,
      profile: makeUser({ allowDietHistory: false }),
    });
    const allowed = buildChatMessages({
      ...base,
      profile: makeUser({ allowDietHistory: true }),
    });
    expect(JSON.stringify(denied)).not.toContain('今天午餐');
    expect(JSON.stringify(allowed)).toContain('今天午餐');
  });

  it('服务端 Mock AI 始终标记 mock', async () => {
    const provider = new MockAiProvider();
    const analysis = await provider.analyzeImage(Buffer.from('any-image'));
    expect(analysis.source).toBe('mock');
    expect(analysis.recognition.foods.length).toBeGreaterThan(0);
    const chat = await provider.chat({
      message: '晚饭吃什么？',
      history: [],
    });
    expect(chat.source).toBe('mock');
    expect(chat.text.length).toBeGreaterThan(10);
  });

  it('缺少 DeepSeek Key 时配置自动进入显式演示模式', () => {
    const noKey = loadConfig({ AI_MOCK_MODE: 'false' });
    expect(noKey.aiConfigured).toBe(false);
    expect(noKey.aiMockMode).toBe(true);

    const withKey = loadConfig({
      AI_MOCK_MODE: 'false',
      DEEPSEEK_API_KEY: 'server-key',
    });
    expect(withKey.aiConfigured).toBe(true);
    expect(withKey.aiMockMode).toBe(false);
  });
});

describe('腾讯云 TTS 适配器', () => {
  const ttsConfig = loadConfig({
    TENCENTCLOUD_SECRET_ID: 'test-secret-id',
    TENCENTCLOUD_SECRET_KEY: 'test-secret-key',
    TTS_REGION: 'ap-beijing',
    TTS_VOICE_TYPE: '101001',
    TTS_ENDPOINT: 'https://tts.tencentcloudapi.com',
  });

  it('TC3 签名结果稳定且不包含 SecretKey', () => {
    const input = {
      secretId: 'test-secret-id',
      secretKey: 'test-secret-key',
      host: 'tts.tencentcloudapi.com',
      payload: '{"Text":"你好"}',
      timestamp: 1_700_000_000,
    };
    const first = buildTencentAuthorization(input);
    const second = buildTencentAuthorization(input);
    expect(first).toBe(second);
    expect(first).toMatch(/^TC3-HMAC-SHA256 Credential=test-secret-id\//);
    expect(first).toContain('SignedHeaders=content-type;host');
    expect(first).not.toContain('test-secret-key');
  });

  it('合成请求包含中文、MP3、16k、音色与语速', async () => {
    const audio = Buffer.from('fake-mp3').toString('base64');
    const fetchMock = vi.fn(async () =>
      jsonResponse({ Response: { Audio: audio, RequestId: 'req-1', SessionId: 'session-1' } }),
    );
    const provider = new TencentTtsProvider(
      ttsConfig,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.synthesize('这顿饭热量大约六百千卡。', {
      language: 'mandarin',
      speed: 0.85,
    });
    expect(result.audioBase64).toBe(audio);
    expect(result.mimeType).toBe('audio/mpeg');
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [, init] = call;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toContain('TC3-HMAC-SHA256');
    expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(headers['X-TC-Action']).toBe('TextToSpeech');
    const body = JSON.parse(String(init.body));
    expect(body.Codec).toBe('mp3');
    expect(body.SampleRate).toBe(16000);
    expect(body.VoiceType).toBe(101001);
    expect(body.PrimaryLanguage).toBe(1);
    expect(body.Speed).toBeGreaterThanOrEqual(-2);
    expect(body.Speed).toBeLessThanOrEqual(2);
  });

  it('缺少凭据时明确返回 TTS_UNAVAILABLE', async () => {
    const provider = new TencentTtsProvider(loadConfig({}));
    await expect(
      provider.synthesize('你好', { language: 'mandarin', speed: 1 }),
    ).rejects.toMatchObject({ code: 'TTS_UNAVAILABLE' });
  });

  it('腾讯云业务错误转成安全的 TTS_FAILED', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        Response: { Error: { Code: 'FailedOperation.Error', Message: 'internal detail' } },
      }),
    );
    const provider = new TencentTtsProvider(
      ttsConfig,
      fetchMock as unknown as typeof fetch,
    );
    try {
      await provider.synthesize('你好', { language: 'mandarin', speed: 1 });
      throw new Error('should_not_reach');
    } catch (error) {
      expect((error as AppError).code).toBe('TTS_FAILED');
      expect((error as AppError).publicMessage).not.toContain('internal detail');
    }
  });
});
