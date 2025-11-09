<template>
    <div class="radio-inputs">
      <div class="slider" :style="{ left: sliderPosition }"></div>
      <label class="radio" v-for="(option, index) in options" :key="index">
        <input type="radio" :name="name" :value="option.value" v-model="selectedOption" @change="updateValue"/>
        <span class="name">
          {{ option.label }}
        </span>
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
        { value: 'vision', label: '视觉' }
      ],
      name: 'model-category-radio',
    };
  },
  computed: {
    sliderPosition() {
      const index = this.options.findIndex(option => option.value === this.selectedOption);
      // 容器内部可用宽度（减去左右padding）
      const containerPadding = 0.25; // rem
      const totalWidth = 150; // px (容器总宽度)
      const availableWidth = totalWidth - (containerPadding * 2 * 16); // 转换rem到px，假设1rem=16px
      const optionWidth = 75;
      
      // 滑块位置 = padding + 选项索引 * 选项宽度
      const leftPosition = containerPadding * 16  + (index * optionWidth);
      return `${leftPosition}px`;
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
  position: relative;
  display: flex;
  border-radius: 0.5rem;
  background-color: var(--platform-toggle-bg);
  /* box-shadow: 0 0 0px 1px rgba(0, 0, 0, 0.06); */
  width: 150px;
  padding: 0.25rem;
  font-size: 14px;
}

.radio-inputs .radio {
  flex: 1 1 auto;
  text-align: center;
  position: relative;
}

.radio-inputs .radio input {
  display: none;
}

.radio-inputs .radio .name {
  display: flex;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border-radius: 0.5rem;
  padding: .2rem 0;
  color: var(--text-secondary);
  transition: color 0.15s ease-in-out;
  position: relative;
  z-index: 2;
  width: 100%;
  white-space: nowrap;
}

.radio-inputs .radio input:checked + .name {
  font-weight: 600;
  color: var(--text-primary);
}

.slider {
  position: absolute;
  background-color: var(--platform-toggle-slider);
  border-radius: 0.4rem;
  transition: all 0.3s ease;
  height: calc(100% - 0.5rem);
  width: calc((100% - 0.5rem) / 2);
  top: 0.25rem;
  left: 0.25rem;
  /* box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12); */
  z-index: 1;
}

/* 深色模式下滑块颜色改为黑色 */
[data-theme="dark"] .slider {
  background-color: #383838;
}

span {
  -webkit-tap-highlight-color: transparent;
}
</style>