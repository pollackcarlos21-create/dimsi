import { randomUUID } from 'node:crypto';
import type {
  ChatInput,
  ChatMessage,
  ChatReply,
  GetConversationResult,
  MealType,
} from '../../../../miniprogram/types/contracts';
import type { AppDependencies, ConversationDocument } from '../domain/types';
import { chatSchema, emptySchema } from '../domain/schemas';
import { chinaDateString } from '../lib/time';
import {
  consumeQuota,
  defaultProfile,
  rateLimit,
} from './common';

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

function recentDateStrings(now: Date, count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    chinaDateString(new Date(now.getTime() - index * 86_400_000)),
  );
}

async function buildMealContext(
  deps: AppDependencies,
  openid: string,
): Promise<string | undefined> {
  const meals = [];
  for (const date of recentDateStrings(deps.now(), 3)) {
    const documents = await deps.repo.listMeals(openid, date, 10);
    meals.push(...documents.map((document) => document.record));
    if (meals.length >= 6) break;
  }
  if (meals.length === 0) return '最近三天没有饮食记录。';
  return meals
    .slice(0, 6)
    .map((meal) => {
      const day = meal.localDate.slice(5);
      return `${day} ${MEAL_LABELS[meal.mealType]}：${meal.mealName}，热量约${meal.nutrition.caloriesKcal.min}-${meal.nutrition.caloriesKcal.max}千卡，蛋白质约${meal.nutrition.proteinG.min}-${meal.nutrition.proteinG.max}克`;
    })
    .join('；');
}

function mapMessages(conversation: ConversationDocument | null): ChatMessage[] {
  if (!conversation) return [];
  return conversation.messages.slice(-20).map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    source: message.source,
  }));
}

export async function getConversation(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
): Promise<GetConversationResult> {
  emptySchema.parse(payload ?? {});
  const conversation = await deps.repo.getConversation(openid);
  return {
    conversationId: conversation?.id ?? '',
    messages: mapMessages(conversation),
  };
}

export async function chat(
  deps: AppDependencies,
  openid: string,
  payload: unknown,
  requestId: string,
): Promise<ChatReply> {
  const input = chatSchema.parse(payload) as ChatInput;
  rateLimit(deps, openid, 'chat');

  const userDocument = await deps.repo.getUser(openid);
  const profile = {
    ...defaultProfile(),
    ...(userDocument?.profile ?? {}),
  };
  const existing = await deps.repo.getConversation(openid);
  const history = existing
    ? existing.messages.slice(-10).map((message) => ({
        role: message.role,
        text: message.text,
      }))
    : [];

  const mealContext = profile.allowDietHistory
    ? await buildMealContext(deps, openid)
    : undefined;

  await consumeQuota(deps, openid, 'chat');

  const bundle = await deps.ai.chat({
    message: input.message,
    history,
    mealContext,
    profile,
  });

  const now = deps.now();
  const conversationId = existing?.id ?? randomUUID();
  const userMessage = {
    id: randomUUID(),
    role: 'user' as const,
    text: input.message,
    createdAt: now.toISOString(),
  };
  const assistantMessage = {
    id: randomUUID(),
    role: 'assistant' as const,
    text: bundle.text,
    createdAt: new Date(now.getTime() + 1).toISOString(),
    source: bundle.source,
  };

  const conversation: ConversationDocument = {
    id: conversationId,
    ownerOpenId: openid,
    messages: [...(existing?.messages ?? []), userMessage, assistantMessage].slice(-40),
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };

  try {
    await deps.repo.saveConversation(conversation);
  } catch (error) {
    deps.logger.error('conversation_persist_failed', {
      requestId,
      detail: error instanceof Error ? error.name : 'unknown',
    });
  }

  deps.logger.info('chat_completed', {
    requestId,
    source: bundle.source,
    aiMs: bundle.aiMs,
    historyUsed: Boolean(mealContext),
  });

  return {
    conversationId,
    message: assistantMessage,
    source: bundle.source,
  };
}
