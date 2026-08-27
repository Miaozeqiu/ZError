<template>
  <div class="settings-sidebar">
    <div class="category-list">
      <div
        v-for="category in categories"
        :key="category.id"
        :class="['category-item', { active: modelValue === category.id }]"
        @click="$emit('update:modelValue', category.id)"
      >
        <div class="category-icon">
          <svg v-if="category.id === 'models'" width="20" height="20" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path d="M469.333333 42.666667v42.666666H298.666667a128 128 0 0 0-128 128v128a213.333333 213.333333 0 0 0 213.333333 213.333334h256a213.333333 213.333333 0 0 0 213.333333-213.333334V213.333333a128 128 0 0 0-128-128h-170.666666V42.666667h-85.333334zM256 213.333333a42.666667 42.666667 0 0 1 42.666667-42.666666h426.666666a42.666667 42.666667 0 0 1 42.666667 42.666666v128a128 128 0 0 1-128 128H384a128 128 0 0 1-128-128V213.333333z m149.333333 170.666667a64 64 0 1 0 0-128 64 64 0 0 0 0 128z m213.333334 0a64 64 0 1 0 0-128 64 64 0 0 0 0 128zM256 938.666667a256 256 0 0 1 512 0h85.333333a341.333333 341.333333 0 1 0-682.666666 0h85.333333z" fill="currentColor"/>
          </svg>
          <svg v-else-if="category.id === 'general'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 17H5"/><path d="M19 7h-9"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>
          </svg>
          <svg v-else-if="category.id === 'about'" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
          </svg>
          <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path :d="category.icon" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <span class="category-name">{{ category.name }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: string
}>()

defineEmits<{
  'update:modelValue': [id: string]
}>()

const categories = [
  {
    id: 'models',
    name: '模型设置',
    icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
  },
  {
    id: 'general',
    name: '常规设置',
    icon: ''
  },
  {
    id: 'about',
    name: '关于应用',
    icon: ''
  }
]
</script>

<style scoped>
.settings-sidebar {
  box-sizing: border-box;
  width: 180px;
  background: var(--bg-secondary, #e2e8f0);
  border-radius: 4px;
  padding: 12px;
  flex-shrink: 0;
  margin-bottom: 5px;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--text-primary);
}

.category-item:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.category-item.active {
  background: var(--color-accent-light);
  color: var(--color-accent);
}

.category-item.active:hover {
  background: var(--color-accent-light);
  color: var(--color-accent);
}

.category-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.category-icon svg {
  display: block;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
}

/* 让图标的 color 成为 svg 及每个子元素自身的属性（而非继承），
   这样无论 currentColor 声明在 svg / path / circle 等哪个元素、有多少段，
   都在本体逐帧过渡，与文字一致；避免 WebKit 对继承型过渡的 currentColor 延迟刷新 */
.category-icon svg,
.category-icon svg * {
  color: var(--text-primary);
}
.category-item.active .category-icon svg,
.category-item.active .category-icon svg * {
  color: var(--color-accent);
}

.category-name {
  font-size: 14px;
  font-weight: 500;
}

@media (max-width: 768px) {
  .settings-sidebar {
    width: 100%;
  }

  .category-list {
    flex-direction: row;
    overflow-x: auto;
  }

  .category-item {
    flex-shrink: 0;
    min-width: 120px;
  }
}
</style>
