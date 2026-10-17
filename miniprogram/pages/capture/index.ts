import { inferMealType } from '../../config';
import type { PendingMeal } from '../../types/client';
import { toApiRequestError, UserCancelledError } from '../../utils/errors';
import { chooseAndPrepareImage, showPermissionGuidance } from '../../utils/image';
import type { PreparedImage } from '../../utils/image';
import { randomId } from '../../utils/id';
import { storage } from '../../utils/storage';

type Source = 'camera' | 'album';

interface CaptureData {
  source: Source;
  state: 'idle' | 'loading' | 'ready' | 'error';
  imagePath: string;
  image: PreparedImage | null;
  sizeLabel: string;
  error: string;
  hint: string;
  captureMs: number;
  privacyNeeded: boolean;
  privacyContractName: string;
  submitting: boolean;
  errorIsPrivacy: boolean;
  showPermissionSettings: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

Page({
  data: {
    source: 'camera',
    state: 'idle',
    imagePath: '',
    image: null,
    sizeLabel: '',
    error: '',
    hint: '',
    captureMs: 0,
    privacyNeeded: false,
    privacyContractName: '',
    submitting: false,
    errorIsPrivacy: false,
    showPermissionSettings: false,
  } as CaptureData,

  onLoad(options: Record<string, string | undefined>) {
    const source: Source = options.source === 'album' ? 'album' : 'camera';
    this.setData({ source });
    this.checkPrivacyThenChoose(source);
  },

  checkPrivacyThenChoose(source: Source) {
    if (typeof wx.getPrivacySetting !== 'function') {
      void this.chooseImage(source);
      return;
    }
    wx.getPrivacySetting({
      success: (result) => {
        if (result.needAuthorization) {
          this.setData({
            privacyNeeded: true,
            privacyContractName: result.privacyContractName || '',
          });
          return;
        }
        void this.chooseImage(source);
      },
      fail: () => {
        // 低版本或隐私接口不可用时，继续由微信原生隐私拦截逻辑处理。
        void this.chooseImage(source);
      },
    });
  },

  onPrivacyAgree() {
    this.setData({ privacyNeeded: false });
    void this.chooseImage(this.data.source);
  },

  onPrivacyDecline() {
    this.setData({ privacyNeeded: false });
    this.onBack();
  },

  onOpenPrivacyContract() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.showToast({ title: '当前版本暂时无法打开隐私指引', icon: 'none' });
      return;
    }
    wx.openPrivacyContract({
      fail: () => {
        wx.showToast({ title: '暂时无法打开隐私指引', icon: 'none' });
      },
    });
  },

  async chooseImage(source?: Source) {
    if (this.data.state === 'loading') return;
    const chosenSource = source ?? this.data.source;
    this.setData({ state: 'loading', error: '', hint: '' });
    wx.showLoading({ title: '处理照片', mask: true });
    const startedAt = Date.now();
    try {
      const image = await chooseAndPrepareImage(chosenSource);
      this.setData({
        state: 'ready',
        imagePath: image.path,
        image,
        sizeLabel: formatSize(image.sizeBytes),
        captureMs: Date.now() - startedAt,
        errorIsPrivacy: false,
        showPermissionSettings: false,
      });
    } catch (error) {
      if (error instanceof UserCancelledError) {
        this.setData({
          state: this.data.imagePath ? 'ready' : 'idle',
          hint: '没有选择也没关系，随时可以再试。',
        });
        return;
      }
      const apiError = toApiRequestError(error);
      const privacyProblem = /隐私|privacy|112/i.test(apiError.message);
      const permissionProblem =
        !privacyProblem && /权限|auth|permission|deny/i.test(apiError.message);
      this.setData({
        state: 'error',
        error: apiError.message,
        errorIsPrivacy: privacyProblem,
        showPermissionSettings: permissionProblem,
        hint: privacyProblem
          ? '请重新查看隐私说明并同意后再使用相机或相册。'
          : permissionProblem
            ? '可以在微信设置中允许知食使用相机和照片。'
            : '',
      });
    } finally {
      wx.hideLoading();
    }
  },

  onTakePhoto() {
    void this.chooseImage('camera');
  },

  onRetakeChoice() {
    void this.chooseImage(this.data.source);
  },

  onChooseAlbum() {
    void this.chooseImage('album');
  },

  onPreview() {
    if (!this.data.imagePath) return;
    wx.previewImage({ urls: [this.data.imagePath], current: this.data.imagePath });
  },

  onAnalyze() {
    if (!this.data.image || this.data.state !== 'ready') return;
    const runtime = this as unknown as { submitLock?: boolean };
    if (runtime.submitLock) return;
    runtime.submitLock = true;
    this.setData({ submitting: true });
    const pending: PendingMeal = {
      localPath: this.data.image.path,
      mealType: inferMealType(),
      createdAt: Date.now(),
      requestId: randomId('req_'),
      sizeBytes: this.data.image.sizeBytes,
      mimeType: this.data.image.mimeType,
      captureMs: this.data.captureMs,
      compressionMs: this.data.image.compressionMs,
    };
    storage.setPendingMeal(pending);
    getApp<IAppOption>().globalData.pendingMeal = pending;
    // 用 redirectTo 替换拍照页，避免结果页返回时留下已消费的旧照片，也避免重拍时页面栈增长。
    wx.redirectTo({
      url: '/pages/result/index?fresh=1',
      fail: () => {
        runtime.submitLock = false;
        this.setData({ submitting: false });
        wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
      },
    });
  },

  onPermissionHelp() {
    showPermissionGuidance();
  },

  onBack() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/home/index' });
      },
    });
  },

  onRetry() {
    this.setData({
      error: '',
      state: 'idle',
      errorIsPrivacy: false,
      showPermissionSettings: false,
    });
    this.checkPrivacyThenChoose(this.data.source);
  },

  noop() {
    // 阻止隐私弹层下的页面滚动穿透。
  },
});
