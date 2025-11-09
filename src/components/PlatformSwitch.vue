<template>
    <div class="radio-inputs">
      <div class="slider" :style="{ left: sliderPosition }"></div>
      <label class="radio" v-for="(option, index) in options" :key="index">
        <input type="radio" :name="name" :value="option" v-model="selectedOption" @change="updateValue"/>
        <span class="name">
          {{ option }}  <!-- 添加文字显示 -->
        </span>
      </label>
    </div>
</template>
  
  <script>
export default {
  props: {
    modelValue: {
      type: String,
      default: '课程',
    },
  },
  data() {
    return {
      selectedOption: this.modelValue,
      options: ['课程', '题目'],  // 移除"题集"选项
      name: 'radio',
    };
  },
  // watch: {
  //   selectedOption(newValue) {
  //     this.$emit('update:modelValue', newValue);
  //   },
  // },
  computed: {
    sliderPosition() {
      const index = this.options.indexOf(this.selectedOption);
      const optionWidth = 100 / this.options.length;  // 根据选项数量动态计算宽度
      return `${index * optionWidth + (optionWidth * 0.05)}%`;  // 调整滑块位置
    },
  },
  methods: {
    updateValue() {
      this.$emit('update:modelValue', this.selectedOption);
    },
  },
};
</script>
  
  <style scoped>
  svg{
    height: 30px;
  }
  .radio-inputs {
    position: relative;
    display: flex;
    border-radius: 0.5rem;
    background-color: #eee;
    box-shadow: 0 0 0px 1px rgba(0, 0, 0, 0.06);
    padding: 0.25rem;
    width: 300px;
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
    padding: .5rem 0;
    color: rgba(51, 65, 85, 1);
    transition: color 0.15s ease-in-out;
    position: relative;
    z-index: 2;
    width: 100%;  /* 修改为100%以适应不同数量的选项 */
    white-space: nowrap;
  }
  
  .radio-inputs .radio input:checked + .name {
    font-weight: 600;
  }
  
  .slider {
    position: absolute;
    background-color: #fff;
    border-radius: 0.5rem;
    transition: all 0.3s ease;
    height: calc(100% - 0.5rem);
    width: 45%;  /* 修改为45%以适应两个选项 */
    top: 0.25rem;
    left: 0.25rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    z-index: 1;
  }

  span{

    -webkit-tap-highlight-color: transparent;
  }
  </style>
  