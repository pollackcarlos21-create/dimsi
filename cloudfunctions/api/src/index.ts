import * as cloud from 'wx-server-sdk';
import { loadConfig } from './lib/config';
import { Logger } from './lib/logger';
import { InMemoryRateLimiter } from './lib/rateLimiter';
import { CloudRepository } from './repositories/cloudRepository';
import { CloudStorageProvider } from './repositories/cloudStorage';
import { DeepSeekProvider } from './providers/deepseek';
import { TencentTtsProvider } from './providers/tencentTts';
import { createAiProvider } from './providers/mockAi';
import { handleRequest } from './router';

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV as unknown as string,
  traceUser: true,
});

const config = loadConfig(process.env);
const db = cloud.database();
const logger = new Logger(console);
const deepseek = new DeepSeekProvider(config);
const deps = {
  config,
  repo: new CloudRepository(db),
  storage: new CloudStorageProvider(cloud),
  ai: createAiProvider(config.aiMockMode, deepseek),
  tts: new TencentTtsProvider(config),
  logger,
  rateLimiter: new InMemoryRateLimiter(),
  now: () => new Date(),
};

interface CloudEvent {
  action?: unknown;
  payload?: unknown;
}

export async function main(event: CloudEvent = {}): Promise<unknown> {
  const context = cloud.getWXContext();
  return handleRequest(
    {
      openid: context.OPENID,
      action: event.action,
      payload: event.payload,
    },
    deps,
  );
}
