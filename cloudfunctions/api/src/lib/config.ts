export interface DailyLimits {
  upload: number;
  analysis: number;
  chat: number;
  tts: number;
}

export interface AppConfig {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  aiMockMode: boolean;
  aiConfigured: boolean;
  aiTimeoutMs: number;
  ttsSecretId: string;
  ttsSecretKey: string;
  ttsRegion: string;
  ttsVoiceType: number;
  ttsCantoneseVoiceType: number;
  ttsEndpoint: string;
  ttsTimeoutMs: number;
  ttsConfigured: boolean;
  dailyLimits: DailyLimits;
  maxImageBytes: number;
  deleteImageAfterAnalysis: boolean;
  maintenanceSecret: string;
  logHashPepper: string;
}

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true';
}

function safeHttpsUrl(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return fallback;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const deepseekApiKey = (env.DEEPSEEK_API_KEY ?? '').trim();
  const forcedMock = parseBoolean(env.AI_MOCK_MODE, false);
  const aiConfigured = deepseekApiKey.length > 0;
  const ttsSecretId = (env.TENCENTCLOUD_SECRET_ID ?? '').trim();
  const ttsSecretKey = (env.TENCENTCLOUD_SECRET_KEY ?? '').trim();

  return {
    deepseekApiKey,
    deepseekBaseUrl: safeHttpsUrl(env.DEEPSEEK_BASE_URL, 'https://api.deepseek.com'),
    deepseekModel: (env.DEEPSEEK_MODEL ?? 'deepseek-flash').trim() || 'deepseek-flash',
    // 显式 Mock 或缺少凭据时进入演示模式；服务端绝不会把 Mock 标成真实 AI。
    aiMockMode: forcedMock || !aiConfigured,
    aiConfigured,
    aiTimeoutMs: positiveInt(env.AI_TIMEOUT_MS, 30_000, 60_000),
    ttsSecretId,
    ttsSecretKey,
    ttsRegion: (env.TTS_REGION ?? 'ap-beijing').trim(),
    ttsVoiceType: positiveInt(env.TTS_VOICE_TYPE, 101001, 999999),
    ttsCantoneseVoiceType: positiveInt(env.TTS_VOICE_TYPE_CANTONESE, 0, 999999),
    ttsEndpoint: safeHttpsUrl(env.TTS_ENDPOINT, 'https://tts.tencentcloudapi.com'),
    ttsTimeoutMs: positiveInt(env.TTS_TIMEOUT_MS, 12_000, 30_000),
    ttsConfigured: ttsSecretId.length > 0 && ttsSecretKey.length > 0,
    dailyLimits: {
      upload: positiveInt(env.DAILY_UPLOAD_LIMIT, 30, 200),
      analysis: positiveInt(env.DAILY_ANALYSIS_LIMIT, 20, 200),
      chat: positiveInt(env.DAILY_CHAT_LIMIT, 60, 500),
      tts: positiveInt(env.DAILY_TTS_LIMIT, 40, 200),
    },
    maxImageBytes: positiveInt(env.MAX_IMAGE_BYTES, 5 * 1024 * 1024, 10 * 1024 * 1024),
    deleteImageAfterAnalysis: parseBoolean(env.DELETE_IMAGE_AFTER_ANALYSIS, true),
    maintenanceSecret: (env.MAINTENANCE_SECRET ?? '').trim(),
    logHashPepper: (env.LOG_HASH_PEPPER ?? 'zhishi-log-v1').trim(),
  };
}
