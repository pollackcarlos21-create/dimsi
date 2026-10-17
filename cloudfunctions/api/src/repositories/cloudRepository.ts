import { createHash } from 'node:crypto';
import type {
  ConversationDocument,
  MealDocument,
  UploadRecord,
  UserDocument,
} from '../domain/types';
import type {
  AppRepository,
  UsageBucket,
  UsageResult,
} from '../domain/types';
import type { MealRecord, UserProfile } from '../../../../miniprogram/types/contracts';

/* eslint-disable @typescript-eslint/no-explicit-any -- wx-server-sdk 的查询类型为动态结构。 */

const COLLECTIONS = {
  uploads: 'uploads',
  meals: 'meals',
  conversations: 'conversations',
  users: 'users',
  usage: 'usage_daily',
} as const;

function removedCount(result: any): number {
  return Number(result?.stats?.removed ?? 0);
}

function updatedCount(result: any): number {
  return Number(result?.stats?.updated ?? 0);
}

function mapUpload(data: any): UploadRecord {
  const status =
    data.status === 'used'
      ? 'used'
      : data.status === 'processing'
        ? 'processing'
        : 'pending';
  return {
    id: String(data._id),
    ownerOpenId: String(data.ownerOpenId),
    cloudPath: String(data.cloudPath),
    declaredMimeType: String(data.declaredMimeType),
    status,
    createdAt: String(data.createdAt),
    expiresAt: String(data.expiresAt),
    processingAt: data.processingAt ? String(data.processingAt) : undefined,
    usedAt: data.usedAt ? String(data.usedAt) : undefined,
    mealId: data.mealId ? String(data.mealId) : undefined,
    fileID: data.fileID ? String(data.fileID) : undefined,
    imageDeletedAt: data.imageDeletedAt ? String(data.imageDeletedAt) : undefined,
  };
}

function mapConversation(data: any): ConversationDocument {
  return {
    id: String(data._id),
    ownerOpenId: String(data.ownerOpenId),
    messages: Array.isArray(data.messages) ? data.messages : [],
    createdAt: String(data.createdAt),
    updatedAt: String(data.updatedAt),
  };
}

function mapUser(data: any): UserDocument {
  return {
    id: String(data._id),
    ownerOpenId: String(data.ownerOpenId),
    profile: data.profile as UserProfile,
    createdAt: String(data.createdAt),
    updatedAt: String(data.updatedAt),
  };
}

export class CloudRepository implements AppRepository {
  constructor(private readonly db: any) {}

  async createUpload(record: UploadRecord): Promise<void> {
    await this.db.collection(COLLECTIONS.uploads).add({
      data: {
        _id: record.id,
        ownerOpenId: record.ownerOpenId,
        cloudPath: record.cloudPath,
        declaredMimeType: record.declaredMimeType,
        status: record.status,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      },
    });
  }

  async getUpload(ownerOpenId: string, uploadId: string): Promise<UploadRecord | null> {
    const result = await this.db
      .collection(COLLECTIONS.uploads)
      .where({ _id: uploadId, ownerOpenId })
      .limit(1)
      .get();
    const data = result?.data?.[0];
    return data ? mapUpload(data) : null;
  }

  async countActiveUploads(ownerOpenId: string, nowIso: string): Promise<number> {
    const _ = this.db.command;
    const result = await this.db
      .collection(COLLECTIONS.uploads)
      .where({
        ownerOpenId,
        status: _.in(['pending', 'processing']),
        expiresAt: _.gt(nowIso),
      })
      .count();
    return Number(result?.total ?? 0);
  }

  async listAllUploads(ownerOpenId: string): Promise<UploadRecord[]> {
    const results: UploadRecord[] = [];
    const pageSize = 100;
    const _ = this.db.command;
    let lastId: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const where: Record<string, unknown> = { ownerOpenId };
      if (lastId) where._id = _.gt(lastId);
      const result = await this.db
        .collection(COLLECTIONS.uploads)
        .where(where)
        .orderBy('_id', 'asc')
        .limit(pageSize)
        .get();
      const rows: any[] = result?.data ?? [];
      results.push(...rows.map(mapUpload));
      if (rows.length < pageSize) break;
      lastId = String(rows[rows.length - 1]._id);
    }
    return results;
  }

  async attachUploadFile(
    ownerOpenId: string,
    uploadId: string,
    fileID: string,
  ): Promise<void> {
    await this.db
      .collection(COLLECTIONS.uploads)
      .where({ _id: uploadId, ownerOpenId })
      .update({ data: { fileID } });
  }

  async claimUpload(
    ownerOpenId: string,
    uploadId: string,
    claimedAtIso: string,
    staleBeforeIso: string,
  ): Promise<'claimed' | 'busy' | 'used' | 'missing'> {
    const collection = this.db.collection(COLLECTIONS.uploads);
    const first = await collection
      .where({ _id: uploadId, ownerOpenId, status: 'pending' })
      .update({
        data: { status: 'processing', processingAt: claimedAtIso },
      });
    if (updatedCount(first) > 0) return 'claimed';

    const current = await this.getUpload(ownerOpenId, uploadId);
    if (!current) return 'missing';
    if (current.status === 'used') return 'used';
    if (current.status !== 'processing') return 'busy';

    if (current.processingAt && current.processingAt > staleBeforeIso) {
      return 'busy';
    }
    const retry = await collection
      .where({
        _id: uploadId,
        ownerOpenId,
        status: 'processing',
        processingAt: current.processingAt ?? '',
      })
      .update({
        data: { status: 'processing', processingAt: claimedAtIso },
      });
    return updatedCount(retry) > 0 ? 'claimed' : 'busy';
  }

  async releaseUploadClaim(
    ownerOpenId: string,
    uploadId: string,
    claimedAtIso: string,
  ): Promise<void> {
    await this.db
      .collection(COLLECTIONS.uploads)
      .where({
        _id: uploadId,
        ownerOpenId,
        status: 'processing',
        processingAt: claimedAtIso,
      })
      .update({
        data: { status: 'pending', processingAt: '' },
      });
  }

  async markUploadUsed(
    ownerOpenId: string,
    uploadId: string,
    mealId: string,
    fileID: string,
    usedAt: string,
  ): Promise<void> {
    await this.db
      .collection(COLLECTIONS.uploads)
      .where({ _id: uploadId, ownerOpenId })
      .update({
        data: {
          status: 'used',
          mealId,
          fileID,
          usedAt,
          processingAt: '',
        },
      });
  }

  async markUploadImageDeleted(
    ownerOpenId: string,
    uploadId: string,
    deletedAt: string,
  ): Promise<void> {
    await this.db
      .collection(COLLECTIONS.uploads)
      .where({ _id: uploadId, ownerOpenId })
      .update({ data: { imageDeletedAt: deletedAt } });
  }

  async getExpiredUploads(limit: number): Promise<UploadRecord[]> {
    const nowIso = new Date().toISOString();
    const _ = this.db.command;
    const result = await this.db
      .collection(COLLECTIONS.uploads)
      .where({ expiresAt: _.lt(nowIso) })
      .limit(Math.min(100, Math.max(1, limit)))
      .get();
    return (result?.data ?? []).map(mapUpload);
  }

  async deleteUpload(ownerOpenId: string, uploadId: string): Promise<void> {
    await this.db
      .collection(COLLECTIONS.uploads)
      .where({ _id: uploadId, ownerOpenId })
      .remove();
  }

  async createMeal(ownerOpenId: string, meal: MealRecord, uploadId?: string): Promise<void> {
    await this.db.collection(COLLECTIONS.meals).add({
      data: {
        _id: meal.id,
        ownerOpenId,
        localDate: meal.localDate,
        createdAt: meal.createdAt,
        updatedAt: meal.createdAt,
        meal,
        uploadId: uploadId ?? '',
      },
    });
  }

  async getMeal(ownerOpenId: string, mealId: string): Promise<MealDocument | null> {
    const result = await this.db
      .collection(COLLECTIONS.meals)
      .where({ _id: mealId, ownerOpenId })
      .limit(1)
      .get();
    const data = result?.data?.[0];
    if (!data) return null;
    return {
      id: String(data._id),
      ownerOpenId: String(data.ownerOpenId),
      record: data.meal as MealRecord,
      uploadId: data.uploadId || undefined,
      imageDeletedAt: data.imageDeletedAt ? String(data.imageDeletedAt) : undefined,
    };
  }

  async getMealByUploadId(
    ownerOpenId: string,
    uploadId: string,
  ): Promise<MealDocument | null> {
    const result = await this.db
      .collection(COLLECTIONS.meals)
      .where({ ownerOpenId, uploadId })
      .limit(1)
      .get();
    const data = result?.data?.[0];
    if (!data) return null;
    return {
      id: String(data._id),
      ownerOpenId: String(data.ownerOpenId),
      record: data.meal as MealRecord,
      uploadId: data.uploadId || undefined,
      imageDeletedAt: data.imageDeletedAt ? String(data.imageDeletedAt) : undefined,
    };
  }

  async listMeals(ownerOpenId: string, localDate: string, limit: number): Promise<MealDocument[]> {
    const result = await this.db
      .collection(COLLECTIONS.meals)
      .where({ ownerOpenId, localDate })
      .orderBy('createdAt', 'desc')
      .limit(Math.min(50, Math.max(1, limit)))
      .get();
    return (result?.data ?? []).map((data: any) => ({
      id: String(data._id),
      ownerOpenId: String(data.ownerOpenId),
      record: data.meal as MealRecord,
      uploadId: data.uploadId || undefined,
      imageDeletedAt: data.imageDeletedAt ? String(data.imageDeletedAt) : undefined,
    }));
  }

  async updateMeal(ownerOpenId: string, mealId: string, record: MealRecord): Promise<boolean> {
    const result = await this.db
      .collection(COLLECTIONS.meals)
      .where({ _id: mealId, ownerOpenId })
      .update({
        data: {
          meal: record,
          updatedAt: new Date().toISOString(),
        },
      });
    return updatedCount(result) > 0;
  }

  async deleteMeal(ownerOpenId: string, mealId: string): Promise<boolean> {
    const result = await this.db
      .collection(COLLECTIONS.meals)
      .where({ _id: mealId, ownerOpenId })
      .remove();
    return removedCount(result) > 0;
  }

  async getUser(ownerOpenId: string): Promise<UserDocument | null> {
    const result = await this.db
      .collection(COLLECTIONS.users)
      .where({ ownerOpenId })
      .limit(1)
      .get();
    const data = result?.data?.[0];
    return data ? mapUser(data) : null;
  }

  async upsertUser(ownerOpenId: string, profile: UserProfile): Promise<UserDocument> {
    const existing = await this.getUser(ownerOpenId);
    const now = new Date().toISOString();
    if (existing) {
      await this.db
        .collection(COLLECTIONS.users)
        .doc(existing.id)
        .update({ data: { profile, updatedAt: now } });
      return { ...existing, profile, updatedAt: now };
    }
    const id = createHash('sha256')
      .update(`${ownerOpenId}:${now}`)
      .digest('hex')
      .slice(0, 32);
    await this.db.collection(COLLECTIONS.users).add({
      data: {
        _id: id,
        ownerOpenId,
        profile,
        createdAt: now,
        updatedAt: now,
      },
    });
    return { id, ownerOpenId, profile, createdAt: now, updatedAt: now };
  }

  async deleteUser(ownerOpenId: string): Promise<boolean> {
    const result = await this.db
      .collection(COLLECTIONS.users)
      .where({ ownerOpenId })
      .remove();
    return removedCount(result) > 0;
  }

  async getConversation(ownerOpenId: string): Promise<ConversationDocument | null> {
    const result = await this.db
      .collection(COLLECTIONS.conversations)
      .where({ ownerOpenId })
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    const data = result?.data?.[0];
    return data ? mapConversation(data) : null;
  }

  async saveConversation(document: ConversationDocument): Promise<void> {
    const result = await this.db
      .collection(COLLECTIONS.conversations)
      .where({ _id: document.id, ownerOpenId: document.ownerOpenId })
      .update({
        data: {
          messages: document.messages.slice(-40),
          updatedAt: document.updatedAt,
        },
      });
    if (updatedCount(result) > 0) return;
    await this.db.collection(COLLECTIONS.conversations).add({
      data: {
        _id: document.id,
        ownerOpenId: document.ownerOpenId,
        messages: document.messages.slice(-40),
        createdAt: document.createdAt,
        updatedAt: document.updatedAt,
      },
    });
  }

  async consumeUsage(
    ownerOpenId: string,
    bucket: UsageBucket,
    limit: number,
    now: Date,
  ): Promise<UsageResult> {
    const chinaDate = new Date(now.getTime() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const ownerKey = createHash('sha256').update(ownerOpenId).digest('hex').slice(0, 20);
    const id = `${ownerKey}_${chinaDate}_${bucket}`;
    const updatedAt = now.toISOString();

    if (typeof this.db.startTransaction === 'function') {
      try {
        const transaction = await this.db.startTransaction();
        try {
          const ref = transaction.collection(COLLECTIONS.usage).doc(id);
          let count = 0;
          let snapshot: any;
          try {
            snapshot = await ref.get();
          } catch (error) {
            // 只有确实不存在时才从 0 开始；其它数据库错误交给降级路径，避免重置配额。
            if (!isMissingDocumentError(error)) throw error;
          }
          count = Number(snapshot?.data?.count ?? 0);
          if (count >= limit) {
            await transaction.rollback();
            return { allowed: false, used: count, limit };
          }
          await ref.set({
            data: {
              // 计数器仅使用哈希后的文档 ID，不保存 openid 或其它个人资料。
              date: chinaDate,
              bucket,
              count: count + 1,
              updatedAt,
            },
          });
          await transaction.commit();
          return { allowed: true, used: count + 1, limit };
        } catch (error) {
          try {
            await transaction.rollback();
          } catch {
            // 忽略回滚错误，交给外层降级路径。
          }
          throw error;
        }
      } catch {
        // 老环境不支持事务或事务失败时降级；下方路径不会把普通数据库错误误判为限额。
      }
    }

    const _ = this.db.command;
    const collection = this.db.collection(COLLECTIONS.usage);
    const snapshot = await collection.where({ _id: id }).limit(1).get();
    const existing = snapshot?.data?.[0];
    if (existing) {
      const count = Number(existing.count ?? 0);
      if (count >= limit) return { allowed: false, used: count, limit };
      await collection
        .where({ _id: id })
        .update({ data: { count: _.inc(1), updatedAt } });
      return { allowed: true, used: count + 1, limit };
    }

    try {
      await collection.add({
        data: {
          _id: id,
          date: chinaDate,
          bucket,
          count: 1,
          updatedAt,
        },
      });
      return { allowed: true, used: 1, limit };
    } catch (error) {
      // 并发创建同一日计数器时重读并自增，不把数据库错误误报成“额度用尽”。
      const retry = await collection.where({ _id: id }).limit(1).get();
      const current = retry?.data?.[0];
      if (!current) throw error;
      const count = Number(current.count ?? 0);
      if (count >= limit) return { allowed: false, used: count, limit };
      await collection
        .where({ _id: id })
        .update({ data: { count: _.inc(1), updatedAt } });
      return { allowed: true, used: count + 1, limit };
    }
  }

  async deleteAllForUser(ownerOpenId: string): Promise<{
    deletedMeals: number;
    deletedConversations: number;
    userDeleted: boolean;
  }> {
    const meals = await this.db
      .collection(COLLECTIONS.meals)
      .where({ ownerOpenId })
      .remove();
    const conversations = await this.db
      .collection(COLLECTIONS.conversations)
      .where({ ownerOpenId })
      .remove();
    const users = await this.db
      .collection(COLLECTIONS.users)
      .where({ ownerOpenId })
      .remove();
    // 上传记录由 deleteAllData 处理器按文件清理结果逐条删除；
    // 每日用量计数为不包含 openid 的伪匿名成本计数器，故意保留以防止“清空数据”重置当日配额。
    return {
      deletedMeals: removedCount(meals),
      deletedConversations: removedCount(conversations),
      userDeleted: removedCount(users) > 0,
    };
  }
}

function isMissingDocumentError(error: unknown): boolean {
  const value = error as { errMsg?: unknown; message?: unknown } | undefined;
  const message = String(value?.errMsg ?? value?.message ?? error ?? '');
  return /not\s*(exist|found)|does not exist|no such document|document.*missing/i.test(
    message,
  );
}
