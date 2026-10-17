import { appConfig } from '../../config';
import { api } from '../../services/api';
import type {
  ActivityLevel,
  AgeRange,
  HealthCheckResult,
  UserProfile,
} from '../../types/contracts';
import { DEFAULT_PROFILE } from '../../types/contracts';
import { toApiRequestError } from '../../utils/errors';
import { clearSpeechAudio } from '../../utils/audio';
import {
  formatDuration,
  latestTiming,
  latestTtsTiming,
  timingSummary,
} from '../../utils/performance';
import { storage } from '../../utils/storage';

const AGE_OPTIONS: Array<{ value: AgeRange; label: string }> = [
  { value: 'unspecified', label: '不填写' },
  { value: '18-44', label: '18–44 岁' },
  { value: '45-59', label: '45–59 岁' },
  { value: '60-74', label: '60–74 岁' },
  { value: '75+', label: '75 岁以上' },
];

const ACTIVITY_OPTIONS: Array<{ value: ActivityLevel; label: string }> = [
  { value: 'unspecified', label: '不填写' },
  { value: 'mostly_sitting', label: '大部分时间久坐' },
  { value: 'light', label: '轻度活动' },
  { value: 'moderate', label: '中等活动' },
  { value: 'active', label: '活动较多' },
];

const GOAL_LABELS = ['吃够蛋白质', '多吃蔬菜', '少油少盐', '规律吃饭', '保持体重'];
const PREFERENCE_LABELS = ['清淡', '少油', '少盐', '不吃辣', '素食', '控糖'];

interface SelectOption {
  label: string;
  selected: boolean;
}

interface SettingsData {
  isDemo: boolean;
  loading: boolean;
  profileError: string;
  profileLoaded: boolean;
  ageOptions: string[];
  ageIndex: number;
  activityOptions: string[];
  activityIndex: number;
  goals: SelectOption[];
  preferences: SelectOption[];
  allergies: string;
  allowHistory: boolean;
  saving: boolean;
  deleting: boolean;
  speechSpeed: number;
  speedOptions: Array<{ value: number; label: string; selected: boolean }>;
  health: HealthCheckResult | null;
  healthError: string;
  showDiagnostics: boolean;
  latestAnalysisText: string;
  latestTtsText: string;
  version: string;
  modeLabel: string;
}

function selectedIndex(
  options: Array<{ value: string }>,
  value: string | undefined,
): number {
  const index = options.findIndex((option) => option.value === value);
  return index >= 0 ? index : 0;
}

function optionsFrom(labels: string[], selected: string[]): SelectOption[] {
  return labels.map((label) => ({ label, selected: selected.includes(label) }));
}

function buildDiagnostics(): {
  latestAnalysisText: string;
  latestTtsText: string;
} {
  const latest = latestTiming();
  const tts = latestTtsTiming();
  let latestAnalysisText = '还没有分析记录。';
  if (latest) {
    const records = storage.getTimings<typeof latest>();
    const summary = timingSummary(records);
    const server = latest.server;
    latestAnalysisText = [
      `最近一次从点按到结果 ${formatDuration(latest.totalMs)}。`,
      latest.captureMs ? `拍照与压缩 ${formatDuration(latest.captureMs)}。` : '',
      latest.compressionMs ? `其中图片压缩 ${formatDuration(latest.compressionMs)}。` : '',
      latest.uploadMs ? `上传 ${formatDuration(latest.uploadMs)}。` : '',
      latest.prepareMs ? `上传准备 ${formatDuration(latest.prepareMs)}。` : '',
      server?.aiMs !== undefined ? `服务端识别 ${formatDuration(server.aiMs)}。` : '',
      server?.calculationMs !== undefined
        ? `营养计算 ${formatDuration(server.calculationMs)}。`
        : '',
      summary.count > 1
        ? `最近 ${summary.count} 次平均 ${formatDuration(summary.averageTotalMs)}。`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
  return {
    latestAnalysisText,
    latestTtsText: tts ? `最近一次语音生成 ${formatDuration(tts.ttsMs)}。` : '还没有语音生成记录。',
  };
}

Page({
  data: {
    isDemo: api.mode === 'local_mock',
    loading: true,
    profileError: '',
    profileLoaded: false,
    ageOptions: AGE_OPTIONS.map((item) => item.label),
    ageIndex: 0,
    activityOptions: ACTIVITY_OPTIONS.map((item) => item.label),
    activityIndex: 0,
    goals: optionsFrom(GOAL_LABELS, []),
    preferences: optionsFrom(PREFERENCE_LABELS, []),
    allergies: '',
    allowHistory: false,
    saving: false,
    deleting: false,
    speechSpeed: storage.getLocalSettings().speechSpeed,
    speedOptions: [
      { value: 0.85, label: '慢一点', selected: false },
      { value: 1, label: '正常', selected: true },
      { value: 1.15, label: '快一点', selected: false },
    ],
    health: null,
    healthError: '',
    showDiagnostics: false,
    latestAnalysisText: '',
    latestTtsText: '',
    version: appConfig.version,
    modeLabel: api.mode === 'local_mock' ? '本地演示' : 'CloudBase 云端',
  } as SettingsData,

  onShow() {
    void this.loadSettings();
  },

  async loadSettings() {
    this.setData({
      loading: true,
      profileError: '',
      profileLoaded: false,
      healthError: '',
      health: null,
    });
    const diagnostics = buildDiagnostics();
    this.setData(diagnostics);
    const speed = storage.getLocalSettings().speechSpeed;
    this.setData({
      speechSpeed: speed,
      speedOptions: this.data.speedOptions.map((option) => ({
        ...option,
        selected: option.value === speed,
      })),
    });

    const results = await Promise.allSettled([api.getProfile(), api.getHealth()]);
    const profileResult = results[0];
    const healthResult = results[1];

    if (profileResult.status === 'fulfilled') {
      this.applyProfile(profileResult.value);
      this.setData({ profileLoaded: true, loading: false });
    } else {
      this.setData({
        loading: false,
        profileError: toApiRequestError(profileResult.reason).message,
      });
    }

    if (healthResult.status === 'fulfilled') {
      this.setData({ health: healthResult.value, healthError: '' });
    } else {
      this.setData({
        healthError: toApiRequestError(healthResult.reason).message,
      });
    }
  },

  applyProfile(profile: UserProfile) {
    this.setData({
      ageIndex: selectedIndex(AGE_OPTIONS, profile.ageRange),
      activityIndex: selectedIndex(ACTIVITY_OPTIONS, profile.activityLevel),
      goals: optionsFrom(GOAL_LABELS, profile.goals ?? []),
      preferences: optionsFrom(PREFERENCE_LABELS, profile.dietaryPreferences ?? []),
      allergies: profile.allergies ?? '',
      allowHistory: Boolean(profile.allowDietHistory),
      profileError: '',
    });
  },

  onAgeChange(event: { detail: { value: string | number } }) {
    this.setData({ ageIndex: Number(event.detail.value) || 0 });
  },

  onActivityChange(event: { detail: { value: string | number } }) {
    this.setData({ activityIndex: Number(event.detail.value) || 0 });
  },

  onToggleGoal(event: WechatMiniprogram.TouchEvent) {
    const label = String(event.currentTarget.dataset.label || '');
    this.setData({
      goals: this.data.goals.map((item) =>
        item.label === label ? { ...item, selected: !item.selected } : item,
      ),
    });
  },

  onTogglePreference(event: WechatMiniprogram.TouchEvent) {
    const label = String(event.currentTarget.dataset.label || '');
    this.setData({
      preferences: this.data.preferences.map((item) =>
        item.label === label ? { ...item, selected: !item.selected } : item,
      ),
    });
  },

  onAllergiesInput(event: WechatMiniprogram.Input) {
    this.setData({ allergies: String(event.detail.value).slice(0, 80) });
  },

  onHistoryChange(event: { detail: { value: boolean } }) {
    this.setData({ allowHistory: Boolean(event.detail.value) });
  },

  async onSaveProfile() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    const input = {
      ageRange: AGE_OPTIONS[this.data.ageIndex]?.value ?? ('unspecified' as const),
      activityLevel:
        ACTIVITY_OPTIONS[this.data.activityIndex]?.value ?? ('unspecified' as const),
      goals: this.data.goals.filter((item) => item.selected).map((item) => item.label),
      dietaryPreferences: this.data.preferences
        .filter((item) => item.selected)
        .map((item) => item.label),
      allergies: this.data.allergies.trim(),
      allowDietHistory: this.data.allowHistory,
    };
    try {
      const profile = await api.updateProfile(input);
      this.applyProfile(profile);
      wx.showToast({ title: '偏好已保存', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: toApiRequestError(error).message, icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  onSpeedSelect(event: WechatMiniprogram.TouchEvent) {
    const speed = Number(event.currentTarget.dataset.speed);
    if (speed !== 0.85 && speed !== 1 && speed !== 1.15) return;
    const settings = storage.getLocalSettings();
    storage.setLocalSettings({ ...settings, speechSpeed: speed });
    this.setData({
      speechSpeed: speed,
      speedOptions: this.data.speedOptions.map((option) => ({
        ...option,
        selected: option.value === speed,
      })),
    });
    wx.showToast({ title: '下次朗读生效', icon: 'none' });
  },

  onToggleDiagnostics() {
    this.setData({ showDiagnostics: !this.data.showDiagnostics });
  },

  onDeleteAll() {
    if (this.data.deleting) return;
    wx.showModal({
      title: '清空全部数据？',
      content:
        '会删除所有餐次记录、聊天记录、个人偏好和上传临时文件，且无法恢复。照片在分析后已删除，不会保留。',
      confirmText: '确认清空',
      confirmColor: '#A34D43',
      cancelText: '保留数据',
      success: (result) => {
        if (result.confirm) void this.deleteAllData();
      },
    });
  },

  async deleteAllData() {
    this.setData({ deleting: true });
    wx.showLoading({ title: '正在清空', mask: true });
    try {
      const pending = storage.getPendingMeal();
      const result = await api.deleteAllData();
      if (pending?.localPath) {
        try {
          wx.getFileSystemManager().unlinkSync(pending.localPath);
        } catch {
          // 临时文件可能已被系统清理。
        }
      }
      storage.clearDemoData();
      clearSpeechAudio();
      this.applyProfile(DEFAULT_PROFILE);
      wx.hideLoading();
      this.setData({
        deleting: false,
        latestAnalysisText: '还没有分析记录。',
        latestTtsText: '还没有语音生成记录。',
      });
      if (!result.complete) {
        wx.showModal({
          title: '可见数据已清空',
          content:
            '餐次、聊天记录和偏好已经删除，但有部分临时照片未能完成清理。系统会在后续维护时重试；如长时间未清理，请联系开发者。',
          showCancel: false,
          confirmText: '知道了',
        });
      } else {
        wx.showToast({ title: '数据已清空', icon: 'success' });
      }
    } catch (error) {
      wx.hideLoading();
      this.setData({ deleting: false });
      wx.showToast({ title: toApiRequestError(error).message, icon: 'none' });
    }
  },

  onRetryProfile() {
    void this.loadSettings();
  },
});
