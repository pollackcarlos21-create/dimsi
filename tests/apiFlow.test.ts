import { describe, expect, it, vi } from 'vitest';
import type {
  ApiResponse,
  ChatReply,
  DeleteAllDataResult,
  GetConversationResult,
  ListMealsResult,
  MealRecord,
  PrepareUploadResult,
  SpeechResult,
} from '../miniprogram/types/contracts';
import { handleRequest } from '../cloudfunctions/api/src/router';
import type { AppDependencies } from '../cloudfunctions/api/src/domain/types';
import { jpegFixture } from './fixtures';
import { createTestDeps, makeUser } from './helpers';

function expectOk<T>(response: ApiResponse<unknown>): T {
  if (!response.ok) {
    throw new Error(`expected ok, got ${response.error.code}: ${response.error.message}`);
  }
  return response.data as T;
}

function expectFailure(response: ApiResponse<unknown>, code: string): void {
  expect(response.ok).toBe(false);
  if (!response.ok) expect(response.error.code).toBe(code);
}

async function prepareUpload(
  deps: AppDependencies,
  openid: string,
  image: Buffer,
  mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
): Promise<{ uploadId: string; fileID: string }> {
  const response = await handleRequest(
    {
      openid,
      action: 'prepareUpload',
      payload: { sizeBytes: image.length, mimeType },
    },
    deps,
  );
  const data = expectOk<PrepareUploadResult>(response);
  const fileID = `cloud://test-env.123/${data.cloudPath}`;
  (deps.storage as unknown as { files: Map<string, Buffer> }).files.set(fileID, image);
  return { uploadId: data.uploadId, fileID };
}

async function analyze(
  deps: AppDependencies,
  openid: string,
  ticket: { uploadId: string; fileID: string },
  mealType = 'lunch',
): Promise<ApiResponse<unknown>> {
  return handleRequest(
    {
      openid,
      action: 'analyzeMeal',
      payload: {
        uploadId: ticket.uploadId,
        fileID: ticket.fileID,
        mealType,
        requestId: 'req_analysis_12345',
      },
    },
    deps,
  );
}

async function createMealFor(
  testDeps: ReturnType<typeof createTestDeps>,
  openid: string,
): Promise<MealRecord> {
  const ticket = await prepareUpload(testDeps.deps, openid, jpegFixture());
  const response = await analyze(testDeps.deps, openid, ticket);
  return expectOk<MealRecord>(response);
}

describe('分析云函数端到端（内存实现）', () => {
  it('上传凭证与照片路径必须匹配', async () => {
    const testDeps = createTestDeps();
    const ticket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    const response = await handleRequest(
      {
        openid: 'user-a',
        action: 'analyzeMeal',
        payload: {
          uploadId: ticket.uploadId,
          fileID: `cloud://test-env.123/meal-images/other/${ticket.uploadId}.jpg`,
          mealType: 'lunch',
          requestId: 'req_analysis_12345',
        },
      },
      testDeps.deps,
    );
    expectFailure(response, 'INVALID_INPUT');
  });

  it('完成识别、营养计算、保存与图片删除', async () => {
    const testDeps = createTestDeps();
    const meal = await createMealFor(testDeps, 'user-a');

    expect(meal.source).toBe('ai');
    expect(meal.mealName).toBe('青椒肉丝配米饭');
    expect(meal.foods).toHaveLength(2);
    expect(meal.nutrition.caloriesKcal.min).toBeGreaterThan(0);
    expect(meal.timings?.aiAttempts).toBe(1);
    expect(testDeps.ai.analysisCalls).toBe(1);
    expect(testDeps.storage.deleted).toHaveLength(1);
    expect(testDeps.storage.files.size).toBe(0);
    const uploads = Array.from(testDeps.repo.uploads.values());
    expect(uploads[0].status).toBe('used');
    expect(uploads[0].mealId).toBe(meal.id);
    expect(uploads[0].imageDeletedAt).toBeTruthy();
  });

  it('同一上传凭证重试时幂等返回，不重复调用 AI', async () => {
    const testDeps = createTestDeps();
    const ticket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    const first = expectOk<MealRecord>(await analyze(testDeps.deps, 'user-a', ticket));
    const second = expectOk<MealRecord>(await analyze(testDeps.deps, 'user-a', ticket));
    expect(second.id).toBe(first.id);
    expect(testDeps.ai.analysisCalls).toBe(1);
  });

  it('用户不能读取或修改另一个用户的餐次', async () => {
    const testDeps = createTestDeps();
    const meal = await createMealFor(testDeps, 'user-a');

    const read = await handleRequest(
      { openid: 'user-b', action: 'getMeal', payload: { mealId: meal.id } },
      testDeps.deps,
    );
    expectFailure(read, 'NOT_FOUND');

    const remove = await handleRequest(
      { openid: 'user-b', action: 'deleteMeal', payload: { mealId: meal.id } },
      testDeps.deps,
    );
    expectFailure(remove, 'NOT_FOUND');
    expect(await testDeps.repo.getMeal('user-a', meal.id)).not.toBeNull();
  });

  it('损坏照片被拒绝且不消耗 AI 配额', async () => {
    const testDeps = createTestDeps();
    const badImage = Buffer.alloc(800, 0x41);
    const ticket = await prepareUpload(testDeps.deps, 'user-a', badImage, 'image/png');
    const response = await analyze(testDeps.deps, 'user-a', ticket);
    expectFailure(response, 'INVALID_IMAGE');
    expect(testDeps.ai.analysisCalls).toBe(0);
    expect(
      Array.from(testDeps.repo.usage.keys()).some((key) => key.endsWith(':analysis')),
    ).toBe(false);
    expect(Array.from(testDeps.repo.uploads.values())[0].fileID).toBe(ticket.fileID);
  });

  it('每日上传票据配额生效，限制存储滥用', async () => {
    const testDeps = createTestDeps();
    testDeps.deps.config.dailyLimits.upload = 1;
    await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    const second = await handleRequest(
      {
        openid: 'user-a',
        action: 'prepareUpload',
        payload: { sizeBytes: 800, mimeType: 'image/jpeg' },
      },
      testDeps.deps,
    );
    expectFailure(second, 'QUOTA_EXCEEDED');
  });

  it('上传完成后可登记 fileID，供过期清理', async () => {
    const testDeps = createTestDeps();
    const ticket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    const response = await handleRequest(
      {
        openid: 'user-a',
        action: 'confirmUpload',
        payload: { uploadId: ticket.uploadId, fileID: ticket.fileID },
      },
      testDeps.deps,
    );
    expectOk(response);
    expect(testDeps.repo.uploads.get(ticket.uploadId)?.fileID).toBe(ticket.fileID);
  });

  it('同一票据并发分析只会调用一次 AI 并保存一餐', async () => {
    const testDeps = createTestDeps();
    const ticket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    let release!: () => void;
    testDeps.ai.analyzeGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const firstPromise = analyze(testDeps.deps, 'user-a', ticket);
    for (let i = 0; i < 50; i += 1) {
      if (testDeps.repo.uploads.get(ticket.uploadId)?.status === 'processing') break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const second = await analyze(testDeps.deps, 'user-a', ticket);
    expectFailure(second, 'RATE_LIMITED');

    release();
    const first = expectOk<MealRecord>(await firstPromise);
    expect(first.id).toBeTruthy();
    expect(testDeps.ai.analysisCalls).toBe(1);
    expect(testDeps.repo.meals.size).toBe(1);
  });

  it('markUploadUsed 失败后可通过 meal.uploadId 恢复，不重复计费', async () => {
    const testDeps = createTestDeps();
    const ticket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    vi.spyOn(testDeps.repo, 'markUploadUsed').mockRejectedValueOnce(
      new Error('simulated_state_write_failure'),
    );

    const first = expectOk<MealRecord>(await analyze(testDeps.deps, 'user-a', ticket));
    expect(testDeps.repo.uploads.get(ticket.uploadId)?.status).toBe('processing');
    const second = expectOk<MealRecord>(await analyze(testDeps.deps, 'user-a', ticket));
    expect(second.id).toBe(first.id);
    expect(testDeps.ai.analysisCalls).toBe(1);
    expect(testDeps.repo.uploads.get(ticket.uploadId)?.status).toBe('used');
  });

  it('过期上传凭证被拒绝', async () => {
    const testDeps = createTestDeps();
    const ticket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    testDeps.deps.now = () => new Date('2026-10-17T06:00:00.000Z');
    const response = await analyze(testDeps.deps, 'user-a', ticket);
    expectFailure(response, 'UPLOAD_EXPIRED');
  });

  it('每日分析配额生效', async () => {
    const testDeps = createTestDeps();
    testDeps.deps.config.dailyLimits.analysis = 1;
    await createMealFor(testDeps, 'user-a');
    const secondTicket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    const second = await analyze(testDeps.deps, 'user-a', secondTicket);
    expectFailure(second, 'QUOTA_EXCEEDED');
    expect(testDeps.ai.analysisCalls).toBe(1);
  });

  it('今日列表只返回当前用户和本地日期的记录', async () => {
    const testDeps = createTestDeps();
    const mealA = await createMealFor(testDeps, 'user-a');
    await createMealFor(testDeps, 'user-b');
    const response = await handleRequest(
      { openid: 'user-a', action: 'listMeals', payload: {} },
      testDeps.deps,
    );
    const data = expectOk<ListMealsResult>(response);
    expect(data.date).toBe('2026-10-17');
    expect(data.meals.map((meal) => meal.id)).toEqual([mealA.id]);
  });

  it('用户可以调整食物与份量，服务端重新计算营养', async () => {
    const testDeps = createTestDeps();
    const meal = await createMealFor(testDeps, 'user-a');
    const response = await handleRequest(
      {
        openid: 'user-a',
        action: 'updateMealFoods',
        payload: {
          mealId: meal.id,
          foods: [{ id: meal.foods[0].id, name: '米饭', portionG: 300 }],
        },
      },
      testDeps.deps,
    );
    const updated = expectOk<MealRecord>(response);
    expect(updated.foods).toHaveLength(1);
    expect(updated.foods[0].portionG).toBe(300);
    expect(updated.nutrition.caloriesKcal).toEqual({ min: 300, max: 420 });
    expect(updated.warnings.join('')).toContain('重新计算');
    expect(updated.timings).toBeUndefined();
  });

  it('删除餐次后无法再读取', async () => {
    const testDeps = createTestDeps();
    const meal = await createMealFor(testDeps, 'user-a');
    const removed = await handleRequest(
      { openid: 'user-a', action: 'deleteMeal', payload: { mealId: meal.id } },
      testDeps.deps,
    );
    expectOk(removed);
    const read = await handleRequest(
      { openid: 'user-a', action: 'getMeal', payload: { mealId: meal.id } },
      testDeps.deps,
    );
    expectFailure(read, 'NOT_FOUND');
  });
});

describe('聊天、语音与数据删除', () => {
  it('默认不发送饮食历史，获得授权后才纳入上下文', async () => {
    const testDeps = createTestDeps();
    const meal = await createMealFor(testDeps, 'user-a');

    const first = await handleRequest(
      { openid: 'user-a', action: 'chat', payload: { message: '晚饭吃什么？' } },
      testDeps.deps,
    );
    expectOk<ChatReply>(first);
    expect(testDeps.ai.lastChatRequest?.mealContext).toBeUndefined();

    await testDeps.repo.upsertUser('user-a', makeUser({ allowDietHistory: true }));
    const second = await handleRequest(
      { openid: 'user-a', action: 'chat', payload: { message: '下一餐怎么搭？' } },
      testDeps.deps,
    );
    const reply = expectOk<ChatReply>(second);
    expect(reply.message.role).toBe('assistant');
    expect(testDeps.ai.lastChatRequest?.mealContext).toContain(meal.mealName);
    expect(testDeps.ai.lastChatRequest?.profile?.allowDietHistory).toBe(true);
  });

  it('聊天记录归属当前用户并可重新读取', async () => {
    const testDeps = createTestDeps();
    await handleRequest(
      { openid: 'user-a', action: 'chat', payload: { message: '蛋白质够不够？' } },
      testDeps.deps,
    );
    const response = await handleRequest(
      { openid: 'user-a', action: 'getConversation', payload: {} },
      testDeps.deps,
    );
    const data = expectOk<GetConversationResult>(response);
    expect(data.messages).toHaveLength(2);
    expect(data.messages[0].role).toBe('user');

    const otherUser = await handleRequest(
      { openid: 'user-b', action: 'getConversation', payload: {} },
      testDeps.deps,
    );
    expect(expectOk<GetConversationResult>(otherUser).messages).toHaveLength(0);
  });

  it('TTS 生成简短摘要，不朗读整份报告', async () => {
    const testDeps = createTestDeps();
    const meal = await createMealFor(testDeps, 'user-a');
    const response = await handleRequest(
      {
        openid: 'user-a',
        action: 'speakMeal',
        payload: { mealId: meal.id, speed: 1.15 },
      },
      testDeps.deps,
    );
    const speech = expectOk<SpeechResult>(response);
    expect(speech.audioBase64.length).toBeGreaterThan(0);
    expect(testDeps.tts.lastSpeed).toBe(1.15);
    expect(testDeps.tts.lastText).toContain(meal.mealName);
    expect(testDeps.tts.lastText.length).toBeLessThanOrEqual(221);
    expect(testDeps.tts.lastText).toContain('仅供参考');
  });

  it('TTS 未配置时返回友好错误，餐次仍可读取', async () => {
    const testDeps = createTestDeps();
    testDeps.tts.configured = false;
    const meal = await createMealFor(testDeps, 'user-a');
    const response = await handleRequest(
      { openid: 'user-a', action: 'speakMeal', payload: { mealId: meal.id } },
      testDeps.deps,
    );
    expectFailure(response, 'TTS_UNAVAILABLE');
    const read = await handleRequest(
      { openid: 'user-a', action: 'getMeal', payload: { mealId: meal.id } },
      testDeps.deps,
    );
    expectOk<MealRecord>(read);
  });

  it('清空数据只影响当前用户', async () => {
    const testDeps = createTestDeps();
    const mealA = await createMealFor(testDeps, 'user-a');
    const mealB = await createMealFor(testDeps, 'user-b');
    await testDeps.repo.upsertUser('user-a', makeUser({ allowDietHistory: true }));
    await handleRequest(
      { openid: 'user-a', action: 'chat', payload: { message: '你好' } },
      testDeps.deps,
    );
    const response = await handleRequest(
      { openid: 'user-a', action: 'deleteAllData', payload: {} },
      testDeps.deps,
    );
    const result = expectOk<DeleteAllDataResult>(response);
    expect(result.deletedMeals).toBe(1);
    expect(result.deletedConversations).toBe(1);
    expect(result.complete).toBe(true);
    expect(await testDeps.repo.getMeal('user-a', mealA.id)).toBeNull();
    expect(await testDeps.repo.getMeal('user-b', mealB.id)).not.toBeNull();
    expect(await testDeps.repo.getUser('user-a')).toBeNull();
  });

  it('维护接口可清理过期上传与文件', async () => {
    const testDeps = createTestDeps();
    testDeps.deps.config.maintenanceSecret = 'test-maintenance-secret';
    const ticket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    await handleRequest(
      {
        openid: 'user-a',
        action: 'confirmUpload',
        payload: { uploadId: ticket.uploadId, fileID: ticket.fileID },
      },
      testDeps.deps,
    );
    const upload = testDeps.repo.uploads.get(ticket.uploadId);
    if (upload) upload.expiresAt = '2020-01-01T00:00:00.000Z';

    const response = await handleRequest(
      {
        openid: '',
        action: 'cleanupExpired',
        payload: { secret: 'test-maintenance-secret', limit: 10 },
      },
      testDeps.deps,
    );
    const result = expectOk<{ deletedFiles: number; deletedRecords: number }>(response);
    expect(result.deletedFiles).toBe(1);
    expect(result.deletedRecords).toBe(1);
    expect(testDeps.storage.files.has(ticket.fileID)).toBe(false);
    expect(testDeps.repo.uploads.has(ticket.uploadId)).toBe(false);
  });

  it('维护接口的错误凭证不暴露接口是否启用', async () => {
    const testDeps = createTestDeps();
    const response = await handleRequest(
      {
        openid: '',
        action: 'cleanupExpired',
        payload: { secret: 'wrong-maintenance-secret' },
      },
      testDeps.deps,
    );
    expectFailure(response, 'UNAUTHENTICATED');
    if (!response.ok) {
      expect(response.error.message).toContain('未启用或凭证无效');
    }
  });

  it('清空数据不会重置当天配额', async () => {
    const testDeps = createTestDeps();
    testDeps.deps.config.dailyLimits.analysis = 1;
    await createMealFor(testDeps, 'user-a');
    const cleared = await handleRequest(
      { openid: 'user-a', action: 'deleteAllData', payload: {} },
      testDeps.deps,
    );
    expectOk(cleared);

    const ticket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    const second = await analyze(testDeps.deps, 'user-a', ticket);
    expectFailure(second, 'QUOTA_EXCEEDED');
  });

  it('图片清理失败时保留上传记录并报告未完全删除', async () => {
    const testDeps = createTestDeps();
    const ticket = await prepareUpload(testDeps.deps, 'user-a', jpegFixture());
    await handleRequest(
      {
        openid: 'user-a',
        action: 'confirmUpload',
        payload: { uploadId: ticket.uploadId, fileID: ticket.fileID },
      },
      testDeps.deps,
    );
    testDeps.storage.failDeleteFor.add(ticket.fileID);

    const response = await handleRequest(
      { openid: 'user-a', action: 'deleteAllData', payload: {} },
      testDeps.deps,
    );
    const result = expectOk<DeleteAllDataResult>(response);
    expect(result.complete).toBe(false);
    expect(result.fileDeletionFailures).toBeGreaterThanOrEqual(1);
    expect(testDeps.repo.uploads.has(ticket.uploadId)).toBe(true);
  });
});

describe('输入校验与安全边界', () => {
  it('拒绝超长聊天消息和非法日期', async () => {
    const testDeps = createTestDeps();
    const chat = await handleRequest(
      {
        openid: 'user-a',
        action: 'chat',
        payload: { message: '呀'.repeat(501) },
      },
      testDeps.deps,
    );
    expectFailure(chat, 'INVALID_INPUT');

    const list = await handleRequest(
      { openid: 'user-a', action: 'listMeals', payload: { date: '2020-01-01' } },
      testDeps.deps,
    );
    expectFailure(list, 'INVALID_INPUT');
  });

  it('拒绝超过配置上限的上传声明', async () => {
    const testDeps = createTestDeps();
    const response = await handleRequest(
      {
        openid: 'user-a',
        action: 'prepareUpload',
        payload: { sizeBytes: 6 * 1024 * 1024, mimeType: 'image/jpeg' },
      },
      testDeps.deps,
    );
    expectFailure(response, 'IMAGE_TOO_LARGE');
  });

  it('未登录调用被拒绝', async () => {
    const testDeps = createTestDeps();
    const response = await handleRequest(
      { openid: '', action: 'getProfile', payload: {} },
      testDeps.deps,
    );
    expectFailure(response, 'UNAUTHENTICATED');
  });

  it('健康检查不暴露密钥', async () => {
    const testDeps = createTestDeps();
    const response = await handleRequest(
      { openid: 'user-a', action: 'health', payload: {} },
      testDeps.deps,
    );
    const data = response.ok
      ? (response.data as Record<string, unknown>)
      : {};
    expect(data.aiConfigured).toBe(true);
    expect(data.ttsConfigured).toBe(true);
    expect(JSON.stringify(data)).not.toContain('test-key');
    expect(JSON.stringify(data)).not.toContain('test-secret');
  });

  it('拒绝未知 action', async () => {
    const testDeps = createTestDeps();
    const response = await handleRequest(
      { openid: 'user-a', action: 'dropAllTables', payload: {} },
      testDeps.deps,
    );
    expectFailure(response, 'INVALID_INPUT');
  });
});
