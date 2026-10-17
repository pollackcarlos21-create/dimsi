import type { ChatMessage } from '../../types/contracts';

interface BubbleView {
  isUser: boolean;
  demo: boolean;
  text: string;
  time: string;
}

Component({
  properties: {
    message: {
      type: Object,
      value: null,
    },
  },
  data: {
    view: null as BubbleView | null,
  },
  observers: {
    message() {
      this.refreshView();
    },
  },
  lifetimes: {
    attached() {
      this.refreshView();
    },
  },
  methods: {
    refreshView() {
      const message = this.data.message as ChatMessage | null;
      if (!message) {
        this.setData({ view: null });
        return;
      }
      const date = new Date(message.createdAt);
      const time = Number.isNaN(date.getTime())
        ? ''
        : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      this.setData({
        view: {
          isUser: message.role === 'user',
          demo: message.role === 'assistant' && message.source === 'mock',
          text: message.text,
          time,
        },
      });
    },
  },
});
