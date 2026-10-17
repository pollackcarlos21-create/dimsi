Component({
  properties: {
    title: {
      type: String,
      value: '还没有记录',
    },
    description: {
      type: String,
      value: '',
    },
    actionText: {
      type: String,
      value: '',
    },
  },
  methods: {
    onAction() {
      this.triggerEvent('action');
    },
  },
});
