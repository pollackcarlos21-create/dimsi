import { appConfig } from './config';
import type { PendingMeal } from './types/client';

export interface AppGlobalData {
  cloudReady: boolean;
  cloudInitError: string;
  pendingMeal?: PendingMeal;
}

App<IAppOption>({
  globalData: {
    cloudReady: false,
    cloudInitError: '',
  },

  onLaunch() {
    if (!appConfig.useCloud) return;
    if (!wx.cloud) {
      this.globalData.cloudInitError = '当前基础库不支持云开发，请升级微信。';
      return;
    }
    try {
      wx.cloud.init({
        env: appConfig.cloudEnvId,
        traceUser: true,
      });
      this.globalData.cloudReady = true;
    } catch (error) {
      this.globalData.cloudInitError =
        error instanceof Error ? error.message : '云开发初始化失败';
    }
  },
});
