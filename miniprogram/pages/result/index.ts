import { api } from '../../services/api';
import type { MealUploadTicket } from '../../services/types';
import type { PendingMeal } from '../../types/client';
import type { MealRecord } from '../../types/contracts';
import { toApiRequestError } from '../../utils/errors';
import {
  confidenceLabel,
  FOOD_CATEGORY_LABELS,
  formatPortion,
  formatRange,
  formatRelativeDate,
  formatTime,
  MEAL_TYPE_LABELS,
} from '../../utils/format';
import { recordAnalysisTiming } from '../../utils/performance';
import { storage } from '../../utils/storage';

interface MetaView {
  typeLabel: string;
  timeLabel: string;
  dateLabel: string;
  confidence: string;
  calories: string;
  protein: string;
  fat: string;
  timingText: string;
}

interface FoodView {
  id: string;
  index: number;
  name: string;
  portionText: string;
  categoryLabel: string;
  confidenceText: string;
  note: string;
  matchedText: string;
}

interface CautionView {
  key: string;
  title: string;
  message: string;
  level: string;
}

interface ResultData {
  state: 'loading' | 'error' | 'ready';
  stageText: string;
  stageHint: string;
  isFresh: boolean;
  isDemoMode: boolean;
  meal: MealRecord | null;
  meta: MetaView | null;
  foods: FoodView[];
  cautions: CautionView[];
  warnings: string[];
  showDetails: boolean;
  methodText: string;
  errorTitle: string;
  errorMessage: string;
  errorCanRetry: boolean;
  errorCanCamera: boolean;
  pending: PendingMeal | null;
  ticket: MealUploadTicket | null;
  prepareMs: number;
  busy: boolean;
  needsRefresh: boolean;
  mealId: string;
  voiceRevision: number;
}

const IMAGE_ERROR_CODES = new Set([
  'INVALID_IMAGE',
  'IMAGE_TOO_LARGE',
  'UPLOAD_NOT_FOUND',
  'UPLOAD_EXPIRED',
]);

function unlinkQuiet(path: string): void {
  try {
    wx.getFileSystemManager().unlinkSync(path);
  } catch {
    // 临时文件可能已被系统清理。
  }
}

function errorTitleFor(code: string): string {
  if (code === 'QUOTA_EXCEEDED') return '今天先到这里';
  if (code === 'RATE_LIMITED') return '慢一点，马上就好';
  if (code === 'NETWORK_ERROR' || code === 'CLOUD_NOT_CONFIGURED') return '暂时没连上';
  if (code === 'UPLOAD_EXPIRED' || code === 'UPLOAD_NOT_FOUND') return '照片需要重新上传';
  if (IMAGE_ERROR_CODES.has(code)) return '这张照片需要换一张';
  if (code === 'RECOGNITION_EMPTY' || code === 'RECOGNITION_FAILED') return '这次没看清';
  return '这次没完成';
}

Page({
  data: {
    state: 'loading',
    stageText: '正在看看这顿饭……',
    stageHint: '先认菜，再估算营养',
    isFresh: false,
    isDemoMode: api.mode === 'local_mock',
    meal: null,
    meta: null,
    foods: [],
    cautions: [],
    warnings: [],
    showDetails: false,
    methodText: '',
    errorTitle: '',
    errorMessage: '',
    errorCanRetry: false,
    errorCanCamera: false,
    pending: null,
    ticket: null,
    prepareMs: 0,
    busy: false,
    needsRefresh: false,
    mealId: '',
    voiceRevision: 0,
  } as ResultData,

  onLoad(options: Record<string, string | undefined>) {
    (this as unknown as { alive?: boolean }).alive = true;
    if (options.mealId) {
      this.setData({ isFresh: false, mealId: options.mealId });
      void this.loadMeal(options.mealId, false);
      return;
    }
    if (options.fresh === '1') {
      const pending =
        storage.getPendingMeal() ??
        getApp<IAppOption>().globalData.pendingMeal ??
        null;
      if (!pending) {
        this.showFailure({
          title: '照片已经失效',
          message: '这张照片没有准备好，请重新拍一张。',
          retryable: false,
          camera: true,
        });
        return;
      }
      this.setData({
        isFresh: true,
        pending,
        state: 'loading',
        stageText: '正在准备照片……',
        stageHint: '照片只在这次分析中使用',
        busy: false,
      });
      void this.runAnalysis();
      return;
    }
    this.showFailure({
      title: '没有找到这顿饭',
      message: '请从今天记录里重新打开，或者拍一张新的照片。',
      retryable: false,
      camera: false,
    });
  },

  onShow() {
    if (this.data.needsRefresh && this.data.meal) {
      this.setData({ needsRefresh: false });
      void this.loadMeal(this.data.meal.id, true);
    }
  },

  onUnload() {
    (this as unknown as { alive?: boolean }).alive = false;
  },

  isAlive(): boolean {
    return (this as unknown as { alive?: boolean }).alive !== false;
  },

  async runAnalysis() {
    if (this.data.busy) return;
    const pending = this.data.pending;
    if (!pending) {
      this.showFailure({
        title: '照片已经失效',
        message: '请重新选择一张照片。',
        retryable: false,
        camera: true,
      });
      return;
    }

    this.setData({
      busy: true,
      state: 'loading',
      stageText: this.data.ticket ? '正在看看这顿饭……' : '正在准备照片……',
      stageHint: this.data.ticket ? '先认菜，再估算营养' : '照片只在这次分析中使用',
    });

    let ticket = this.data.ticket;
    let prepareMs = this.data.prepareMs;
    try {
      if (!ticket) {
        const prepareStarted = Date.now();
        ticket = await api.prepareMealImage({
          path: pending.localPath,
          sizeBytes: pending.sizeBytes,
          mimeType: pending.mimeType,
        });
        if (!this.isAlive()) return;
        prepareMs = Date.now() - prepareStarted;
        this.setData({
          ticket,
          prepareMs,
          stageText: '正在看看这顿饭……',
          stageHint: '先认菜，再估算营养',
        });
      }

      const analyzeStarted = Date.now();
      const meal = await api.analyzeMeal(ticket, {
        mealType: pending.mealType,
        requestId: pending.requestId,
      });
      const analyzeMs = Date.now() - analyzeStarted;
      const totalMs = Math.max(0, Date.now() - pending.createdAt);

      recordAnalysisTiming({
        createdAt: new Date().toISOString(),
        mode: api.mode,
        source: meal.source,
        captureMs: pending.captureMs,
        compressionMs: pending.compressionMs,
        prepareMs,
        uploadMs: ticket.uploadMs ?? 0,
        analyzeMs,
        totalMs,
        server: meal.timings,
      });

      storage.clearPendingMeal();
      const app = getApp<IAppOption>();
      app.globalData.pendingMeal = undefined;
      if (this.isAlive()) {
        this.applyMeal(meal, true);
        unlinkQuiet(pending.localPath);
        this.setData({ pending: null, ticket: null, prepareMs: 0, busy: false });
      } else {
        // 用户已离开结果页；分析已完成，清理本地临时图，餐次仍可从“今天”查看。
        unlinkQuiet(pending.localPath);
      }
    } catch (error) {
      if (!this.isAlive()) return;
      const apiError = toApiRequestError(error);
      const imageProblem = IMAGE_ERROR_CODES.has(apiError.code);
      this.setData({
        state: 'error',
        busy: false,
        errorTitle: errorTitleFor(apiError.code),
        errorMessage: apiError.message,
        errorCanRetry: apiError.retryable,
        errorCanCamera: imageProblem || !pending,
        ticket: imageProblem ? null : this.data.ticket,
        prepareMs: imageProblem ? 0 : this.data.prepareMs,
      });
    }
  },

  async loadMeal(mealId: string, silent: boolean) {
    if (!silent) {
      this.setData({
        state: 'loading',
        stageText: '正在取回这顿饭……',
        stageHint: '稍等一下',
        errorMessage: '',
      });
    }
    try {
      const meal = await api.getMeal(mealId);
      if (!this.isAlive()) return;
      this.applyMeal(meal, false);
    } catch (error) {
      if (!this.isAlive()) return;
      if (silent) {
        wx.showToast({ title: '刷新失败，请稍后再试', icon: 'none' });
        return;
      }
      const apiError = toApiRequestError(error);
      this.setData({
        state: 'error',
        errorTitle: errorTitleFor(apiError.code),
        errorMessage: apiError.message,
        errorCanRetry: apiError.retryable,
        errorCanCamera: false,
      });
    }
  },

  applyMeal(meal: MealRecord, fresh: boolean) {
    const created = new Date(meal.createdAt);
    const timeLabel = Number.isNaN(created.getTime()) ? '' : formatTime(meal.createdAt);
    const dateLabel = formatRelativeDate(meal.localDate);
    const timing = meal.timings;
    const timingText =
      meal.source === 'mock'
        ? ''
        : timing
          ? [
              timing.downloadMs !== undefined ? `读取照片 ${timing.downloadMs} 毫秒` : '',
              timing.aiMs !== undefined ? `识别 ${(timing.aiMs / 1000).toFixed(1)} 秒` : '',
              timing.calculationMs !== undefined
                ? `营养计算 ${timing.calculationMs} 毫秒`
                : '',
              `总耗时 ${(timing.totalMs / 1000).toFixed(1)} 秒`,
            ]
              .filter(Boolean)
              .join(' · ')
          : '';

    const foods: FoodView[] = meal.foods.map((food, index) => ({
      id: food.id,
      index: index + 1,
      name: food.name,
      portionText: formatPortion(food),
      categoryLabel: FOOD_CATEGORY_LABELS[food.category] ?? '其他',
      confidenceText: confidenceLabel(food.confidence),
      note: food.note ?? '',
      matchedText:
        food.matchedName && food.matchedName !== food.name
          ? `按「${food.matchedName}」估算`
          : '',
    }));

    const cautions: CautionView[] = [];
    if (meal.oilCaution.level === 'medium' || meal.oilCaution.level === 'high') {
      cautions.push({
        key: 'oil',
        title: '用油',
        message: meal.oilCaution.message,
        level: meal.oilCaution.level,
      });
    }
    if (meal.saltCaution.level === 'high') {
      cautions.push({
        key: 'salt',
        title: '咸淡',
        message: meal.saltCaution.message,
        level: meal.saltCaution.level,
      });
    }

    this.setData({
      state: 'ready',
      meal,
      mealId: meal.id,
      isFresh: fresh ? true : this.data.isFresh,
      meta: {
        typeLabel: MEAL_TYPE_LABELS[meal.mealType],
        timeLabel,
        dateLabel,
        confidence: confidenceLabel(meal.confidence),
        calories: formatRange(meal.nutrition.caloriesKcal),
        protein: formatRange(meal.nutrition.proteinG),
        fat: formatRange(meal.nutrition.fatG),
        timingText,
      },
      foods,
      cautions,
      warnings: meal.warnings,
      showDetails: false,
      methodText:
        meal.source === 'mock'
          ? '当前为演示模式：营养值来自固定示例，并非从这张照片识别计算。真实模式会先识别食物与份量，再由服务端食物成分数据计算。'
          : '先用 AI 识别食物、份量与做法，再由服务端的食物成分数据计算营养区间。模型不会直接决定最终营养数值。',
      errorMessage: '',
      busy: false,
      voiceRevision: (this.data.voiceRevision || 0) + 1,
    });
    wx.setNavigationBarTitle({ title: '这顿饭' });
  },

  showFailure(input: {
    title: string;
    message: string;
    retryable: boolean;
    camera: boolean;
  }) {
    this.setData({
      state: 'error',
      errorTitle: input.title,
      errorMessage: input.message,
      errorCanRetry: input.retryable,
      errorCanCamera: input.camera,
      busy: false,
    });
  },

  onRetry() {
    if (this.data.isFresh) {
      void this.runAnalysis();
    } else if (this.data.mealId) {
      void this.loadMeal(this.data.mealId, false);
    }
  },

  onRetake() {
    storage.clearPendingMeal();
    getApp<IAppOption>().globalData.pendingMeal = undefined;
    const pending = this.data.pending;
    if (pending?.localPath) unlinkQuiet(pending.localPath);
    wx.redirectTo({
      url: '/pages/capture/index?source=camera',
      fail: () => {
        wx.switchTab({ url: '/pages/home/index' });
      },
    });
  },

  onEdit() {
    if (!this.data.meal) return;
    this.setData({ needsRefresh: true });
    wx.navigateTo({ url: `/pages/correction/index?mealId=${this.data.meal.id}` });
  },

  onToggleDetails() {
    this.setData({ showDetails: !this.data.showDetails });
  },

  onBackToday() {
    wx.switchTab({ url: '/pages/meals/index' });
  },

  onDelete() {
    if (!this.data.meal || this.data.busy) return;
    const mealId = this.data.meal.id;
    wx.showModal({
      title: '删除这条记录？',
      content: '删除后无法恢复。照片在分析完成后已经删除，这里只会移除餐次和营养估算。',
      confirmText: '删除',
      confirmColor: '#A34D43',
      cancelText: '保留',
      success: (result) => {
        if (!result.confirm) return;
        void this.deleteMeal(mealId);
      },
    });
  },

  async deleteMeal(mealId: string) {
    this.setData({ busy: true });
    wx.showLoading({ title: '正在删除', mask: true });
    try {
      await api.deleteMeal(mealId);
      storage.clearPendingMeal();
      wx.hideLoading();
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/meals/index' });
      }, 350);
    } catch (error) {
      wx.hideLoading();
      this.setData({ busy: false });
      wx.showToast({ title: toApiRequestError(error).message, icon: 'none' });
    }
  },
});
