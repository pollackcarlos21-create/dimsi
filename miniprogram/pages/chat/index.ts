import { api } from '../../services/api';
import type { ChatMessage } from '../../types/contracts';
import { toApiRequestError } from '../../utils/errors';
import { randomId } from '../../utils/id';

const PRESETS = [
  '晚饭应该吃什么？',
  '今天蛋白质够不够？',
  '这道菜是不是太油了？',
  '我应该怎么运动？',
];

function welcomeMessage(): ChatMessage {
  return {
    id: 'welcome',
    role: 'assistant',
    text:
      '你好，我是知食。可以问我下一餐怎么搭、蛋白质够不够，或者这顿饭是不是偏油。我会尽量说人话，也会说明哪些只是估算。',
    createdAt: new Date().toISOString(),
  };
}

interface ChatData {
  isDemo: boolean;
  hasMock: boolean;
  loading: boolean;
  error: string;
  messages: ChatMessage[];
  welcome: ChatMessage;
  input: string;
  sending: boolean;
  conversationId: string;
  allowHistory: boolean;
  profileLoaded: boolean;
  consentBusy: boolean;
  scrollIntoView: string;
  loaded: boolean;
  presets: string[];
  canSend: boolean;
}

Page({
  data: {
    isDemo: api.mode === 'local_mock',
    hasMock: false,
    loading: true,
    error: '',
    messages: [],
    welcome: welcomeMessage(),
    input: '',
    sending: false,
    conversationId: '',
    allowHistory: false,
    profileLoaded: false,
    consentBusy: false,
    scrollIntoView: '',
    loaded: false,
    presets: PRESETS,
    canSend: false,
  } as ChatData,

  onShow() {
    if (!this.data.loaded) {
      void this.loadConversation();
      return;
    }
    if (!this.data.sending) {
      void this.refreshConversation();
    }
    void this.refreshProfile();
  },

  async refreshConversation() {
    const expectedLength = this.data.messages.length;
    try {
      const conversation = await api.getConversation();
      if (this.data.sending || this.data.messages.length !== expectedLength) return;
      this.setData({
        messages: conversation.messages,
        conversationId: conversation.conversationId,
        hasMock: conversation.messages.some(
          (message) => message.role === 'assistant' && message.source === 'mock',
        ),
      });
    } catch {
      // 保留当前界面内容；下次进入或发送时会再次尝试。
    }
  },

  async loadConversation() {
    this.setData({ loading: true, error: '' });
    try {
      const conversation = await api.getConversation();
      this.setData({
        messages: conversation.messages,
        conversationId: conversation.conversationId,
        hasMock: conversation.messages.some(
          (message) => message.role === 'assistant' && message.source === 'mock',
        ),
        loading: false,
        loaded: true,
      });
      this.scrollToBottom();
    } catch (error) {
      this.setData({
        loading: false,
        error: toApiRequestError(error).message,
      });
      return;
    }
    await this.refreshProfile();
  },

  async refreshProfile() {
    try {
      const profile = await api.getProfile();
      this.setData({
        allowHistory: profile.allowDietHistory,
        profileLoaded: true,
      });
    } catch {
      this.setData({ profileLoaded: false });
    }
  },

  onRetry() {
    void this.loadConversation();
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    const input = event.detail.value.slice(0, 500);
    this.setData({
      input,
      canSend: input.trim().length > 0 && !this.data.sending && this.data.loaded,
    });
  },

  onPresetTap(event: WechatMiniprogram.TouchEvent) {
    const question = String(event.currentTarget.dataset.question || '');
    if (!question || this.data.sending) return;
    void this.sendMessage(question);
  },

  onSend() {
    const text = this.data.input.trim();
    if (!text || this.data.sending) return;
    void this.sendMessage(text);
  },

  async sendMessage(rawText: string) {
    if (this.data.sending || !this.data.loaded) return;
    const text = rawText.trim().slice(0, 500);
    if (!text) return;

    const previousInput = this.data.input;
    const tempMessage: ChatMessage = {
      id: randomId('local_'),
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    this.setData({
      messages: [...this.data.messages, tempMessage],
      input: '',
      canSend: false,
      sending: true,
      error: '',
    });
    this.scrollToBottom();

    try {
      const reply = await api.chat({
        message: text,
        conversationId: this.data.conversationId || undefined,
      });
      this.setData({
        messages: [...this.data.messages, reply.message],
        conversationId: reply.conversationId,
        hasMock: this.data.hasMock || reply.source === 'mock',
        sending: false,
      });
      this.scrollToBottom();
    } catch (error) {
      const message = toApiRequestError(error).message;
      this.setData({
        messages: this.data.messages.filter((item) => item.id !== tempMessage.id),
        input: this.data.input || previousInput || text,
        sending: false,
        canSend: true,
      });
      wx.showToast({ title: message, icon: 'none', duration: 2400 });
    }
  },

  onAllowHistory() {
    if (this.data.consentBusy) return;
    wx.showModal({
      title: '允许参考最近饮食？',
      content:
        '开启后，助手可以参考最近三天的餐次名称和营养估算，给出更贴合的建议。不会发送照片，也不会读取其他用户的数据。你可以随时在设置里关闭。',
      confirmText: '允许',
      cancelText: '暂时不用',
      success: (result) => {
        if (result.confirm) void this.enableHistory();
      },
    });
  },

  async enableHistory() {
    this.setData({ consentBusy: true });
    try {
      await api.updateProfile({ allowDietHistory: true });
      this.setData({ allowHistory: true, consentBusy: false });
      wx.showToast({ title: '已开启', icon: 'success' });
    } catch (error) {
      this.setData({ consentBusy: false });
      wx.showToast({ title: toApiRequestError(error).message, icon: 'none' });
    }
  },

  scrollToBottom() {
    this.setData({ scrollIntoView: '' }, () => {
      this.setData({ scrollIntoView: 'chat-bottom' });
    });
  },
});
