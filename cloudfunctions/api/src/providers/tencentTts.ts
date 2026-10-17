import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { SpeechLanguage } from '../../../../miniprogram/types/contracts';
import type { AppConfig } from '../lib/config';
import { AppError } from '../lib/errors';
import { postJson, ProviderHttpError, ProviderTimeoutError } from '../lib/http';
import type { TtsProvider } from '../domain/types';

const SERVICE = 'tts';
const ACTION = 'TextToSpeech';
const VERSION = '2019-08-23';

interface TencentTtsResponse {
  Response?: {
    Audio?: string;
    SessionId?: string;
    RequestId?: string;
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacSha256(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

export function buildTencentAuthorization(input: {
  secretId: string;
  secretKey: string;
  host: string;
  payload: string;
  timestamp: number;
}): string {
  const { secretId, secretKey, host, payload } = input;
  const timestamp = input.timestamp;
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');
  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, SERVICE);
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function cleanSpeechText(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function mapSpeed(speed: number): number {
  const bounded = Math.min(1.15, Math.max(0.85, speed));
  // 腾讯云 TTS 的 Speed 取值以 0 为正常语速；客户端仍会做本地 playbackRate 微调。
  return Math.round((bounded - 1) * 5 * 10) / 10;
}

export class TencentTtsProvider implements TtsProvider {
  readonly configured: boolean;

  constructor(
    private readonly config: AppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.configured = config.ttsConfigured;
  }

  async synthesize(
    text: string,
    options: { language: SpeechLanguage; speed: number },
  ): Promise<{ audioBase64: string; mimeType: 'audio/mpeg'; voice: SpeechLanguage }> {
    if (!this.configured) {
      throw new AppError('TTS_UNAVAILABLE');
    }
    const voiceType =
      options.language === 'cantonese'
        ? this.config.ttsCantoneseVoiceType
        : this.config.ttsVoiceType;
    if (!voiceType) {
      throw new AppError('TTS_UNAVAILABLE', {
        message: '粤语朗读暂未开通，普通话朗读和文字建议不受影响。',
      });
    }
    const cleaned = cleanSpeechText(text);
    if (!cleaned) {
      throw new AppError('TTS_FAILED', { retryable: true });
    }

    const payloadObject = {
      Text: cleaned,
      SessionId: randomUUID(),
      ModelType: 1,
      VoiceType: voiceType,
      Speed: mapSpeed(options.speed),
      Volume: 0,
      ProjectId: 0,
      Codec: 'mp3',
      SampleRate: 16000,
      // 腾讯云 PrimaryLanguage 1 表示中文；粤语通过独立 VoiceType 扩展。
      PrimaryLanguage: 1,
      EnableSubtitle: false,
    };
    const payload = JSON.stringify(payloadObject);
    const endpoint = new URL(this.config.ttsEndpoint);
    const host = endpoint.host;
    const timestamp = Math.floor(Date.now() / 1000);
    const authorization = buildTencentAuthorization({
      secretId: this.config.ttsSecretId,
      secretKey: this.config.ttsSecretKey,
      host,
      payload,
      timestamp,
    });

    let raw: string;
    try {
      raw = await postJson({
        url: this.config.ttsEndpoint,
        body: payloadObject,
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json; charset=utf-8',
          'X-TC-Action': ACTION,
          'X-TC-Timestamp': String(timestamp),
          'X-TC-Version': VERSION,
          'X-TC-Region': this.config.ttsRegion,
        },
        timeoutMs: this.config.ttsTimeoutMs,
        maxResponseChars: 10 * 1024 * 1024,
        fetchImpl: this.fetchImpl,
      });
    } catch (error) {
      if (error instanceof ProviderTimeoutError) {
        throw new AppError('TTS_FAILED', {
          message: '语音生成得有点慢，可以稍后再试。',
          retryable: true,
          internalDetail: 'tencent_tts_timeout',
        });
      }
      if (error instanceof ProviderHttpError) {
        throw new AppError('TTS_FAILED', {
          retryable: error.retryable,
          internalDetail: `tencent_tts_http_${error.status}`,
          logLevel: 'error',
        });
      }
      throw error;
    }

    let parsed: TencentTtsResponse;
    try {
      parsed = JSON.parse(raw) as TencentTtsResponse;
    } catch {
      throw new AppError('TTS_FAILED', {
        retryable: true,
        internalDetail: 'tencent_tts_invalid_json',
      });
    }

    const response = parsed.Response;
    if (response?.Error) {
      throw new AppError('TTS_FAILED', {
        retryable: false,
        internalDetail: `tencent_tts_${response.Error.Code ?? 'unknown_error'}`,
        logLevel: 'error',
      });
    }
    const audio = response?.Audio?.replace(/\s+/g, '');
    if (!audio || !/^[A-Za-z0-9+/=]+$/.test(audio)) {
      throw new AppError('TTS_FAILED', {
        retryable: true,
        internalDetail: 'tencent_tts_empty_audio',
      });
    }
    if (audio.length > 9 * 1024 * 1024) {
      throw new AppError('TTS_FAILED', {
        retryable: false,
        internalDetail: 'tencent_tts_audio_too_large',
      });
    }

    return {
      audioBase64: audio,
      mimeType: 'audio/mpeg',
      voice: options.language,
    };
  }
}
