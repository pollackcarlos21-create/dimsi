Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    title: {
      type: String,
      value: '',
    },
    subtitle: {
      type: String,
      value: '',
    },
    warm: {
      type: Boolean,
      value: false,
    },
  },
});
