<template>
  <div class="radio-inputs" :data-selected-index="selectedIndex">
    <div class="slider"></div>
    <label class="radio" v-for="(option, index) in options" :key="index">
      <input type="radio" :name="name" :value="option.value" v-model="selectedOption" @change="updateValue"/>
      <span class="name">{{ option.label }}</span>
    </label>
  </div>
</template>

<script>
export default {
  name: 'ModelCategorySwitch',
  props: {
    modelValue: {
      type: String,
      default: 'text',
    },
  },
  data() {
    return {
      selectedOption: this.modelValue,
      options: [
        { value: 'text', label: '文本' },
        { value: 'vision', label: '视觉' },
        { value: 'summary', label: '总结' }
      ],
      name: 'model-category-radio',
    };
  },
  computed: {
    selectedIndex() {
      return this.options.findIndex(o => o.value === this.selectedOption);
    },
  },
  methods: {
    updateValue() {
      this.$emit('update:modelValue', this.selectedOption);
    },
  },
  watch: {
    modelValue(newValue) {
      this.selectedOption = newValue;
    }
  }
};
</script>

<style scoped>
.radio-inputs {
  --n: 3;          /* 选项总数 */
  --pad: 3px;      /* 内边距 */

  position: relative;
  display: flex;
  border-radius: 0.5rem;
  background-color: var(--platform-toggle-bg);
  padding: var(--pad);
  font-size: 14px;
}

.radio-inputs .radio {
  flex: 1 1 0;
  text-align: center;
  position: relative;
  z-index: 2;
}

.radio-inputs .radio input {
  display: none;
}

.radio-inputs .radio .name {
  display: flex;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border-radius: 0.4rem;
  padding: 0.1rem 0.5rem;
  color: var(--text-secondary);
  transition: color 0.15s ease;
  white-space: nowrap;
  user-select: none;
}

.radio-inputs .radio input:checked + .name {
  font-weight: 600;
  color: var(--text-primary);
}

/* 滑块：宽度 = 1/n，left 由 data-selected-index 驱动 */
.slider {
  position: absolute;
  top: var(--pad);
  left: var(--pad);
  height: calc(100% - var(--pad) * 2);
  width: calc((100% - var(--pad) * 2) / var(--n));
  border-radius: 0.4rem;
  background-color: var(--platform-toggle-slider);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 1;
  pointer-events: none;
}

[data-theme="dark"] .slider {
  background-color: #383838;
}

/* 根据 data-selected-index 平移滑块 */
.radio-inputs[data-selected-index="0"] .slider { transform: translateX(0); }
.radio-inputs[data-selected-index="1"] .slider { transform: translateX(100%); }
.radio-inputs[data-selected-index="2"] .slider { transform: translateX(200%); }

span {
  -webkit-tap-highlight-color: transparent;
}
</style>
