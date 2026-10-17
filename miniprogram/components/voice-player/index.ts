import { api } from '../../services/api';
import { writeSpeechAudio } from '../../utils/audio';
import { userMessage } from '../../utils/errors';
import { recordTtsTiming } from '../../utils/performance';
import { storage } from '../../utils/storage';

type VoiceStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
type VoiceRate = 0.85 | 1 | 1.15;

interface VoiceData {
  status: VoiceStatus;
  error: string;
  rate: VoiceRate;
  rateLabel: string;
  hasAudio: boolean;
}

interface VoiceInternals {
  audio: WechatMiniprogram.InnerAudioContext | null;
  audioPath: string;
  alive: boolean;
  visible: boolean;
}

const RATES: VoiceRate[] = [0.85, 1, 1.15];

function normalizeRate(value: number): VoiceRate {
  return value === 0.85 || value === 1.15 ? value : 1;
}

function rateLabel(rate: number): string {
  return `${rate.toFixed(2).replace(/0$/, '')}×`;
}

Component({
  properties: {
    mealId: {
      type: String,
      value: '',
    },
    revision: {
      type: Number,
      value: 0,
    },
  },
  data: {
    status: 'idle',
    error: '',
    rate: normalizeRate(storage.getLocalSettings().speechSpeed),
    rateLabel: rateLabel(normalizeRate(storage.getLocalSettings().speechSpeed)),
    hasAudio: false,
  } as VoiceData,

  observers: {
    revision() {
      const internals = this as unknown as VoiceInternals;
      if (internals.audio && this.data.hasAudio) {
        internals.audio.stop();
        internals.audio.src = '';
      }
      if (internals.audioPath) {
        try {
          wx.getFileSystemManager().unlinkSync(internals.audioPath);
        } catch {
          // ignore
        }
        internals.audioPath = '';
      }
      if (this.data.status !== 'idle' || this.data.hasAudio) {
        this.setData({ status: 'idle', hasAudio: false, error: '' });
      }
    },
  },

  lifetimes: {
    attached() {
      const internals = this as unknown as VoiceInternals;
      internals.alive = true;
      internals.visible = true;
      internals.audioPath = '';
      const storedRate = normalizeRate(storage.getLocalSettings().speechSpeed);
      this.setData({ rate: storedRate, rateLabel: rateLabel(storedRate) });
      const audio = wx.createInnerAudioContext();
      internals.audio = audio;
      audio.autoplay = false;
      audio.onPlay(() => {
        if (!internals.alive) return;
        if (!internals.visible) {
          audio.pause();
          return;
        }
        this.setData({ status: 'playing', error: '' });
      });
      audio.onPause(() => {
        if (!internals.alive || !this.data.hasAudio) return;
        this.setData({ status: 'paused' });
      });
      audio.onStop(() => {
        if (!internals.alive || !this.data.hasAudio) return;
        this.setData({ status: 'paused' });
      });
      audio.onEnded(() => {
        if (!internals.alive || !this.data.hasAudio) return;
        this.setData({ status: 'ended' });
      });
      audio.onError(() => {
        if (!internals.alive || this.data.status === 'idle') return;
        this.setData({
          status: 'error',
          error: '语音播放失败了，可以再试一次。',
        });
      });
      audio.playbackRate = storedRate;
    },

    detached() {
      const internals = this as unknown as VoiceInternals;
      internals.alive = false;
      if (internals.audio) {
        internals.audio.pause();
        internals.audio.destroy();
        internals.audio = null;
      }
      if (internals.audioPath) {
        try {
          wx.getFileSystemManager().unlinkSync(internals.audioPath);
        } catch {
          // 临时音频清理失败不影响页面。
        }
      }
    },
  },

  pageLifetimes: {
    show() {
      (this as unknown as VoiceInternals).visible = true;
    },
    hide() {
      const internals = this as unknown as VoiceInternals;
      internals.visible = false;
      if (internals.audio && this.data.status === 'playing') {
        internals.audio.pause();
      }
    },
  },

  methods: {
    async onToggle() {
      const internals = this as unknown as VoiceInternals;
      if (!this.data.mealId || this.data.status === 'loading') return;

      if (this.data.hasAudio && internals.audio) {
        if (this.data.status === 'playing') {
          internals.audio.pause();
          return;
        }
        if (this.data.status === 'ended') {
          internals.audio.seek(0);
        }
        internals.audio.play();
        return;
      }

      this.setData({ status: 'loading', error: '' });
      const revisionAtStart = this.data.revision;
      const ttsStartedAt = Date.now();
      try {
        const speech = await api.speakMeal(this.data.mealId, 1);
        recordTtsTiming(Date.now() - ttsStartedAt);
        if (!internals.alive || this.data.revision !== revisionAtStart) return;
        const path = writeSpeechAudio(speech.audioBase64);
        internals.audioPath = path;
        const audio = internals.audio;
        if (!audio) return;
        audio.src = path;
        audio.playbackRate = this.data.rate;
        if (internals.visible) {
          audio.play();
          this.setData({ status: 'playing', hasAudio: true, error: '' });
        } else {
          // 页面已隐藏时不自动播放，回到页面后用户点一下即可继续。
          this.setData({ status: 'paused', hasAudio: true, error: '' });
        }
      } catch (error) {
        if (!internals.alive || this.data.revision !== revisionAtStart) return;
        this.setData({
          status: 'error',
          error: userMessage(error),
          hasAudio: false,
        });
      }
    },

    onCycleRate() {
      const rate = RATES[(RATES.indexOf(this.data.rate) + 1) % RATES.length];
      const internals = this as unknown as VoiceInternals;
      if (internals.audio && this.data.hasAudio) {
        internals.audio.playbackRate = rate;
      }
      const settings = storage.getLocalSettings();
      storage.setLocalSettings({ ...settings, speechSpeed: rate });
      this.setData({ rate, rateLabel: rateLabel(rate) });
    },
  },
});
