<template>
  <div 
    v-if="visible" 
    class="context-menu" 
    :style="menuStyle"
    @click.stop
  >
    <!-- 菜单头部（可选） -->
    <div v-if="header" class="menu-header">
      {{ header }}
    </div>
    <div v-if="header" class="menu-divider"></div>
    
    <!-- 菜单项 -->
    <template v-for="item in menuItems" :key="item.id || item.label">
      <!-- 分隔线 -->
      <div v-if="item.type === 'divider'" class="menu-divider"></div>
      
      <!-- 标题项 -->
      <div v-else-if="item.type === 'header'" class="menu-header">
        {{ item.label }}
      </div>
      
      <!-- 普通菜单项 -->
      <div 
        v-else
        class="menu-item" 
        :class="{ 
          disabled: item.disabled, 
          danger: item.danger 
        }"
        @click="handleItemClick(item)"
      >
        <!-- 图标 -->
        <div v-if="item.icon" class="menu-icon">
          <!-- SVG 图标 -->
          <svg 
            v-if="item.icon.type === 'svg'" 
            width="16" 
            height="16" 
            :viewBox="item.icon.viewBox || '0 0 24 24'" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path 
              v-for="(path, index) in item.icon.paths" 
              :key="`path-${index}`"
              :d="path.d"
              :fill="path.fill || 'none'"
              :stroke="path.stroke || 'currentColor'"
              :stroke-width="path.strokeWidth || 2"
            />
            <rect 
              v-for="(rect, index) in item.icon.rects" 
              :key="`rect-${index}`"
              :x="rect.x"
              :y="rect.y"
              :width="rect.width"
              :height="rect.height"
              :rx="rect.rx"
              :ry="rect.ry"
              :fill="rect.fill || 'none'"
              :stroke="rect.stroke || 'currentColor'"
              :stroke-width="rect.strokeWidth || 2"
            />
            <polyline 
              v-for="(polyline, index) in item.icon.polylines" 
              :key="`polyline-${index}`"
              :points="polyline.points"
              :fill="polyline.fill || 'none'"
              :stroke="polyline.stroke || 'currentColor'"
              :stroke-width="polyline.strokeWidth || 2"
            />
          </svg>
          
          <!-- Emoji 图标 -->
          <span v-else-if="item.icon.type === 'emoji'">{{ item.icon.content }}</span>
          
          <!-- 文本图标 -->
          <span v-else-if="item.icon.type === 'text'">{{ item.icon.content }}</span>
        </div>
        
        <!-- 标签 -->
        <span class="menu-label">{{ item.label }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

export interface MenuIcon {
  type: 'svg' | 'emoji' | 'text'
  // SVG 图标属性
  viewBox?: string
  width?: number
  height?: number
  paths?: Array<{
    d: string
    fill?: string
    stroke?: string
    strokeWidth?: number
  }>
  polylines?: Array<{
    points: string
    fill?: string
    stroke?: string
    strokeWidth?: number
  }>
  rects?: Array<{
    x: number
    y: number
    width: number
    height: number
    rx?: number
    ry?: number
    fill?: string
    stroke?: string
    strokeWidth?: number
  }>
  // Emoji 图标属性
  emoji?: string
  // 文本图标属性
  text?: string
}

export interface MenuItem {
  id?: string;
  type?: 'item' | 'divider' | 'header';
  label?: string;
  icon?: MenuIcon | string;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
  shortcut?: string;
  action?: string;
  data?: any;
}

interface Props {
  visible: boolean;
  x: number;
  y: number;
  menuItems: MenuItem[];
  header?: string;
  maxHeight?: number;
}

const props = withDefaults(defineProps<Props>(), {
  maxHeight: 400
});

const emit = defineEmits<{
  'item-click': [item: MenuItem];
}>();

// 处理菜单项点击
const handleItemClick = (item: MenuItem) => {
  if (item.disabled) return;
  emit('item-click', item);
};

// 计算菜单位置，防止超出窗口边界
const menuStyle = computed(() => {
  if (!props.visible) return {};
  
  const menuWidth = 180; // 菜单宽度
  const itemHeight = 32; // 每个菜单项高度
  const headerHeight = props.header ? 32 : 0;
  const padding = 8;
  const dividerCount = props.menuItems.filter(item => item.type === 'divider').length;
  const itemCount = props.menuItems.filter(item => item.type !== 'divider').length;
  
  let menuHeight = headerHeight + (itemCount * itemHeight) + (dividerCount * 9) + (padding * 2);
  menuHeight = Math.min(menuHeight, props.maxHeight);
  
  const windowPadding = 10; // 距离边界的最小距离
  
  let left = props.x;
  let top = props.y;
  
  // 检查右边界
  if (left + menuWidth + windowPadding > window.innerWidth) {
    left = window.innerWidth - menuWidth - windowPadding;
  }
  
  // 检查下边界
  if (top + menuHeight + windowPadding > window.innerHeight) {
    top = window.innerHeight - menuHeight - windowPadding;
  }
  
  // 检查左边界
  if (left < windowPadding) {
    left = windowPadding;
  }
  
  // 检查上边界
  if (top < windowPadding) {
    top = windowPadding;
  }
  
  return {
    left: `${left}px`,
    top: `${top}px`,
    maxHeight: `${props.maxHeight}px`
  };
});
</script>

<style scoped>
.context-menu {
  position: fixed;
  background: var(--context-menu-bg, #ffffff);
  border: 1px solid var(--context-menu-border, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  z-index: 1000;
  min-width: 160px;
  padding: 8px;
  font-size: 14px;
  overflow-y: auto;
}

/* 菜单标题样式 */
.menu-header {
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 4px;
  background: #f9fafb;
}

/* 菜单项样式 */

.menu-item {
  border-radius: 4px;
  display: flex;
  align-items: center;
  padding: 4px 8px;
  color: var(--context-menu-item-text, #2d3748);
  cursor: pointer;
  transition: all 0.2s ease;
  gap: 8px;
  min-height: 12px;
}

.menu-item:hover:not(.disabled) {
  background-color: var(--context-menu-item-hover-bg, #f7fafc);
}

.menu-item.disabled {
  color: var(--context-menu-item-disabled-text, #a0aec0);
  cursor: not-allowed;
  opacity: 0.6;
}

.menu-item.danger {
  color: var(--danger-color, #e53e3e);
}

.menu-item.danger:hover:not(.disabled) {
  background-color: var(--danger-bg, #fed7d7);
}

.menu-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
}

.menu-text {
  flex: 1;
}

.menu-shortcut {
  font-size: 12px;
  color: var(--context-menu-shortcut-text, #a0aec0);
  margin-left: auto;
}

.menu-divider {
  height: 1px;
  background-color: var(--context-menu-divider-bg, #e2e8f0);
  margin: 4px 0;
}

/* 深色主题支持 */
[data-theme="dark"] .context-menu {
  background: var(--context-menu-bg, #2d3748);
  border-color: var(--context-menu-border, #4a5568);
}

[data-theme="dark"] .menu-header {
  color: var(--context-menu-header-text, #a0aec0);
}

[data-theme="dark"] .menu-item {
  color: var(--context-menu-item-text, #e2e8f0);
}

[data-theme="dark"] .menu-item:hover:not(.disabled) {
  background-color: var(--context-menu-item-hover-bg, #4a5568);
}

[data-theme="dark"] .menu-item.disabled {
  color: var(--context-menu-item-disabled-text, #718096);
}

[data-theme="dark"] .menu-item.danger:hover:not(.disabled) {
  background-color: var(--danger-bg, #742a2a);
}

[data-theme="dark"] .menu-shortcut {
  color: var(--context-menu-shortcut-text, #718096);
}

[data-theme="dark"] .menu-divider {
  background-color: var(--context-menu-divider-bg, #4a5568);
}
</style>