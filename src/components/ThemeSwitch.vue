<template>
  <div class="radio-inputs" :data-selected-index="selectedIndex">
    <div class="slider"></div>
    <label class="radio" v-for="(option, i) in options" :key="i" :title="option.label">
      <input type="radio" name="theme-radio" :value="option.value" v-model="selected" @change="$emit('update:modelValue', selected)"/>
      <span class="name">
        <svg v-if="option.value === 'light'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
        </svg>
        <svg v-else-if="option.value === 'dark'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
        </svg>
        <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>
        </svg>
        {{ option.label }}
      </span>
    </label>
  </div>
</template>

<script>
export default {
  name: 'ThemeSwitch',
  props: {
    modelValue: { type: String, default: 'auto' }
  },
  emits: ['update:modelValue'],
  data() {
    return {
      selected: this.modelValue,
      options: [
        { value: 'light', label: '浅色' },
        { value: 'dark',  label: '深色' },
        { value: 'auto',  label: '系统' },
      ]
    }
  },
  computed: {
    selectedIndex() {
      return this.options.findIndex(o => o.value === this.selected)
    }
  },
  watch: {
    modelValue(v) { this.selected = v }
  }
}
</script>

<style scoped>
.radio-inputs {
  --n: 3;
  --pad: 3px;
  position: relative;
  display: flex;
  border-radius: 0.5rem;
  background-color: var(--platform-toggle-bg);
  padding: var(--pad);
  font-size: 14px;
}

.radio {
  flex: 1 1 0;
  text-align: center;
  position: relative;
  z-index: 2;
}

.radio input { display: none; }

.radio .name {
  display: flex;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: 0.4rem;
  padding: 0.2rem 0.6rem;
  color: var(--text-secondary);
  transition: color 0.15s ease;
  white-space: nowrap;
  user-select: none;
}

.radio input:checked + .name {
  font-weight: 600;
  color: var(--text-primary);
}

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

[data-theme="dark"] .slider { background-color: #383838; }

.radio-inputs[data-selected-index="0"] .slider { transform: translateX(0); }
.radio-inputs[data-selected-index="1"] .slider { transform: translateX(100%); }
.radio-inputs[data-selected-index="2"] .slider { transform: translateX(200%); }
</style>
