import type { MealRecord, UserProfile } from '../miniprogram/types/contracts';
import { DEFAULT_PROFILE } from '../miniprogram/types/contracts';
import { loadConfig, type AppConfig } from '../cloudfunctions/api/src/lib/config';
import { Logger } from '../cloudfunctions/api/src/lib/logger';
import { AppError } from '../cloudfunctions/api/src/lib/errors';
import type {
  AiProvider,
  AppDependencies,
  AppRepository,
  ChatBundle,
  ChatRequest,
  ConversationDocument,
  MealDocument,
  RecognitionBundle,
  RecognitionResult,
  StorageProvider,
  TtsProvider,
  UploadRecord,
  UsageBucket,
  UsageResult,
  UserDocument,
} from '../cloudfunctions/api/src/domain/types';
import { sampleRecognition } from './fixtures';

function clone<T>(value: T): T {
  return structuredClone(value);
}

function chinaDate(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export class MemoryRepository implements AppRepository {
  uploads = new Map<string, UploadRecord>();
  meals = new Map<string, MealDocument>();
  conversations = new Map<string, ConversationDocument>();
  users = new Map<string, UserDocument>();
  usage = new Map<string, number>();

  async createUpload(record: UploadRecord): Promise<void> {
    this.uploads.set(record.id, clone(record));
  }

  async getUpload(ownerOpenId: string, uploadId: string): Promise<UploadRecord | null> {
    const record = this.uploads.get(uploadId);
    if (!record || record.ownerOpenId !== ownerOpenId) return null;
    return clone(record);
  }

  async countActiveUploads(ownerOpenId: string, nowIso: string): Promise<number> {
    return Array.from(this.uploads.values()).filter(
      (upload) =>
        upload.ownerOpenId === ownerOpenId &&
        (upload.status === 'pending' || upload.status === 'processing') &&
        upload.expiresAt > nowIso,
    ).length;
  }

  async listAllUploads(ownerOpenId: string): Promise<UploadRecord[]> {
    return Array.from(this.uploads.values())
      .filter((upload) => upload.ownerOpenId === ownerOpenId)
      .map(clone);
  }

  async attachUploadFile(
    ownerOpenId: string,
    uploadId: string,
    fileID: string,
  ): Promise<void> {
    const record = this.uploads.get(uploadId);
    if (!record || record.ownerOpenId !== ownerOpenId) return;
    record.fileID = fileID;
  }

  async claimUpload(
    ownerOpenId: string,
    uploadId: string,
    claimedAtIso: string,
    staleBeforeIso: string,
  ): Promise<'claimed' | 'busy' | 'used' | 'missing'> {
    const record = this.uploads.get(uploadId);
    if (!record || record.ownerOpenId !== ownerOpenId) return 'missing';
    if (record.status === 'used') return 'used';
    if (record.status === 'processing') {
      if (record.processingAt && record.processingAt > staleBeforeIso) return 'busy';
      if (record.processingAt === undefined) return 'busy';
    }
    record.status = 'processing';
    record.processingAt = claimedAtIso;
    return 'claimed';
  }

  async releaseUploadClaim(
    ownerOpenId: string,
    uploadId: string,
    claimedAtIso: string,
  ): Promise<void> {
    const record = this.uploads.get(uploadId);
    if (
      !record ||
      record.ownerOpenId !== ownerOpenId ||
      record.status !== 'processing' ||
      record.processingAt !== claimedAtIso
    ) {
      return;
    }
    record.status = 'pending';
    record.processingAt = undefined;
  }

  async markUploadUsed(
    ownerOpenId: string,
    uploadId: string,
    mealId: string,
    fileID: string,
    usedAt: string,
  ): Promise<void> {
    const record = this.uploads.get(uploadId);
    if (!record || record.ownerOpenId !== ownerOpenId) return;
    Object.assign(record, { status: 'used', mealId, fileID, usedAt, processingAt: undefined });
  }

  async markUploadImageDeleted(
    ownerOpenId: string,
    uploadId: string,
    deletedAt: string,
  ): Promise<void> {
    const record = this.uploads.get(uploadId);
    if (!record || record.ownerOpenId !== ownerOpenId) return;
    record.imageDeletedAt = deletedAt;
  }

  async getExpiredUploads(limit: number): Promise<UploadRecord[]> {
    const now = Date.now();
    return Array.from(this.uploads.values())
      .filter((upload) => Date.parse(upload.expiresAt) <= now)
      .slice(0, limit)
      .map(clone);
  }

  async deleteUpload(ownerOpenId: string, uploadId: string): Promise<void> {
    const record = this.uploads.get(uploadId);
    if (record?.ownerOpenId === ownerOpenId) this.uploads.delete(uploadId);
  }

  async createMeal(ownerOpenId: string, meal: MealRecord, uploadId?: string): Promise<void> {
    this.meals.set(meal.id, {
      id: meal.id,
      ownerOpenId,
      record: clone(meal),
      uploadId,
    });
  }

  async getMeal(ownerOpenId: string, mealId: string): Promise<MealDocument | null> {
    const document = this.meals.get(mealId);
    return document?.ownerOpenId === ownerOpenId ? clone(document) : null;
  }

  async getMealByUploadId(
    ownerOpenId: string,
    uploadId: string,
  ): Promise<MealDocument | null> {
    const document = Array.from(this.meals.values()).find(
      (item) =>
        item.ownerOpenId === ownerOpenId && item.uploadId === uploadId,
    );
    return document ? clone(document) : null;
  }

  async listMeals(
    ownerOpenId: string,
    localDate: string,
    limit: number,
  ): Promise<MealDocument[]> {
    return Array.from(this.meals.values())
      .filter(
        (document) =>
          document.ownerOpenId === ownerOpenId && document.record.localDate === localDate,
      )
      .sort((a, b) => Date.parse(b.record.createdAt) - Date.parse(a.record.createdAt))
      .slice(0, limit)
      .map(clone);
  }

  async updateMeal(
    ownerOpenId: string,
    mealId: string,
    record: MealRecord,
  ): Promise<boolean> {
    const document = this.meals.get(mealId);
    if (!document || document.ownerOpenId !== ownerOpenId) return false;
    document.record = clone(record);
    return true;
  }

  async deleteMeal(ownerOpenId: string, mealId: string): Promise<boolean> {
    const document = this.meals.get(mealId);
    if (!document || document.ownerOpenId !== ownerOpenId) return false;
    return this.meals.delete(mealId);
  }

  async getUser(ownerOpenId: string): Promise<UserDocument | null> {
    const user = this.users.get(ownerOpenId);
    return user ? clone(user) : null;
  }

  async upsertUser(ownerOpenId: string, profile: UserProfile): Promise<UserDocument> {
    const now = new Date().toISOString();
    const previous = this.users.get(ownerOpenId);
    const user: UserDocument = {
      id: previous?.id ?? `user-${ownerOpenId}`,
      ownerOpenId,
      profile: clone(profile),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.users.set(ownerOpenId, user);
    return clone(user);
  }

  async deleteUser(ownerOpenId: string): Promise<boolean> {
    return this.users.delete(ownerOpenId);
  }

  async getConversation(ownerOpenId: string): Promise<ConversationDocument | null> {
    const conversation = this.conversations.get(ownerOpenId);
    return conversation ? clone(conversation) : null;
  }

  async saveConversation(document: ConversationDocument): Promise<void> {
    this.conversations.set(document.ownerOpenId, clone(document));
  }

  async consumeUsage(
    ownerOpenId: string,
    bucket: UsageBucket,
    limit: number,
    now: Date,
  ): Promise<UsageResult> {
    const key = `${ownerOpenId}:${chinaDate(now)}:${bucket}`;
    const count = this.usage.get(key) ?? 0;
    if (count >= limit) return { allowed: false, used: count, limit };
    this.usage.set(key, count + 1);
    return { allowed: true, used: count + 1, limit };
  }

  async deleteAllForUser(ownerOpenId: string): Promise<{
    deletedMeals: number;
    deletedConversations: number;
    userDeleted: boolean;
  }> {
    let deletedMeals = 0;
    for (const [id, document] of this.meals) {
      if (document.ownerOpenId === ownerOpenId) {
        this.meals.delete(id);
        deletedMeals += 1;
      }
    }
    const deletedConversations = this.conversations.delete(ownerOpenId) ? 1 : 0;
    const userDeleted = this.users.delete(ownerOpenId);
    // 与生产实现一致：上传记录由处理器逐条删除，用量计数保留。
    return { deletedMeals, deletedConversations, userDeleted };
  }
}

export class MemoryStorage implements StorageProvider {
  files = new Map<string, Buffer>();
  deleted: string[] = [];
  failDeleteFor = new Set<string>();

  async downloadFile(fileID: string): Promise<Buffer> {
    const file = this.files.get(fileID);
    if (!file) throw new AppError('UPLOAD_NOT_FOUND');
    return Buffer.from(file);
  }

  async deleteFile(fileID: string): Promise<void> {
    if (this.failDeleteFor.has(fileID)) {
      throw new Error('simulated_storage_delete_failure');
    }
    this.files.delete(fileID);
    this.deleted.push(fileID);
  }
}

export class FakeAi implements AiProvider {
  mode: 'ai' | 'mock' = 'ai';
  analysisCalls = 0;
  recognition: RecognitionResult = sampleRecognition();
  chatText = '下一餐可以加一份绿叶菜，再配一点鱼或豆腐。';
  lastChatRequest: ChatRequest | null = null;
  analyzeGate: Promise<void> | null = null;

  async analyzeImage(): Promise<RecognitionBundle> {
    this.analysisCalls += 1;
    if (this.analyzeGate) await this.analyzeGate;
    return {
      recognition: clone(this.recognition),
      source: this.mode,
      attempts: 1,
      aiMs: 25,
      model: 'fake',
    };
  }

  async chat(request: ChatRequest): Promise<ChatBundle> {
    this.lastChatRequest = clone(request);
    return { text: this.chatText, source: this.mode, aiMs: 12 };
  }
}

export class FakeTts implements TtsProvider {
  configured = true;
  lastText = '';
  lastSpeed = 1;
  failWith: Error | null = null;

  async synthesize(
    text: string,
    options: { language: 'mandarin' | 'cantonese'; speed: number },
  ): Promise<{ audioBase64: string; mimeType: 'audio/mpeg'; voice: 'mandarin' | 'cantonese' }> {
    if (this.failWith) throw this.failWith;
    this.lastText = text;
    this.lastSpeed = options.speed;
    return {
      audioBase64: Buffer.from('fake-mp3-audio').toString('base64'),
      mimeType: 'audio/mpeg',
      voice: options.language,
    };
  }
}

export class AllowAllRateLimiter {
  allow(): boolean {
    return true;
  }
}

export class MemoryLoggerSink {
  entries: Array<{ level: string; raw: string }> = [];
  info(raw: string): void {
    this.entries.push({ level: 'info', raw });
  }
  warn(raw: string): void {
    this.entries.push({ level: 'warn', raw });
  }
  error(raw: string): void {
    this.entries.push({ level: 'error', raw });
  }
}

export interface TestDeps {
  deps: AppDependencies;
  repo: MemoryRepository;
  storage: MemoryStorage;
  ai: FakeAi;
  tts: FakeTts;
  logs: MemoryLoggerSink;
  config: AppConfig;
}

export function createTestDeps(overrides: Partial<AppConfig> = {}): TestDeps {
  const config: AppConfig = {
    ...loadConfig({
      DEEPSEEK_API_KEY: 'test-key',
      AI_MOCK_MODE: 'false',
      TENCENTCLOUD_SECRET_ID: 'test-id',
      TENCENTCLOUD_SECRET_KEY: 'test-secret',
      DAILY_ANALYSIS_LIMIT: '20',
      DAILY_CHAT_LIMIT: '60',
      DAILY_TTS_LIMIT: '40',
      DELETE_IMAGE_AFTER_ANALYSIS: 'true',
    }),
    ...overrides,
  };
  const repo = new MemoryRepository();
  const storage = new MemoryStorage();
  const ai = new FakeAi();
  const tts = new FakeTts();
  const logs = new MemoryLoggerSink();
  const logger = new Logger(logs);
  const deps: AppDependencies = {
    config,
    repo,
    storage,
    ai,
    tts,
    logger,
    rateLimiter: new AllowAllRateLimiter(),
    now: () => new Date('2026-10-17T04:20:00.000Z'),
  };
  return { deps, repo, storage, ai, tts, logs, config };
}

export function makeUser(profile: Partial<UserProfile> = {}): UserProfile {
  return { ...DEFAULT_PROFILE, ...profile };
}
