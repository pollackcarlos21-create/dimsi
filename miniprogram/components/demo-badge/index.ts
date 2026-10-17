Component({
  properties: {
    source: {
      type: String,
      value: '',
    },
    showAiLabel: {
      type: Boolean,
      value: false,
    },
    label: {
      type: String,
      value: '',
    },
  },
  data: {
    display: '',
    demo: false,
  },
  lifetimes: {
    attached() {
      this.refreshBadge();
    },
  },
  observers: {
    'source, showAiLabel, label'() {
      this.refreshBadge();
    },
  },
  methods: {
    refreshBadge() {
      const source = this.data.source;
      const label = this.data.label;
      this.setData({
        display: label
          ? label
          : source === 'mock'
            ? '演示数据'
            : source === 'ai' && this.data.showAiLabel
              ? 'AI 估算'
              : '',
        demo: source === 'mock',
      });
    },
  },
});
