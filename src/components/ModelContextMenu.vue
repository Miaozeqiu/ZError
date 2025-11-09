<template>
  <UnifiedContextMenu
    :visible="visible"
    :x="x"
    :y="y"
    :menu-items="menuItems"
    @item-click="handleItemClick"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import UnifiedContextMenu, { type MenuItem } from './UnifiedContextMenu.vue'
import type { AIModel } from '../services/modelConfig'

interface Props {
  visible: boolean
  x: number
  y: number
  model?: AIModel | null
}

defineProps<Props>()

const emit = defineEmits<{
  'edit-model': []
  'duplicate-model': []
  'test-model': []
  'delete-model': []
}>()

// 定义菜单项
const menuItems = computed<MenuItem[]>(() => [
  {
    id: 'edit-model',
    label: '编辑模型',
    action: 'edit-model',
    icon: {
      type: 'svg',
      paths: [
        { d: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7' },
        { d: 'M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z' }
      ]
    }
  },
  { type: 'divider' },
  {
    id: 'duplicate-model',
    label: '复制模型',
    action: 'duplicate-model',
    icon: {
      type: 'svg',
      rects: [{ x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }],
      paths: [{ d: 'M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1' }]
    }
  },
  { type: 'divider' },
  {
    id: 'test-model',
    label: '测试模型',
    action: 'test-model',
    icon: {
      type: 'svg',
      paths: [
        { d: 'M9 12l2 2 4-4' },
        { d: 'M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z' }
      ]
    }
  },
  { type: 'divider' },
  {
    id: 'delete-model',
    label: '删除模型',
    action: 'delete-model',
    danger: true,
    icon: {
      type: 'svg',
      polylines: [{ points: '3,6 5,6 21,6' }],
      paths: [{ d: 'M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2' }]
    }
  }
])

// 处理菜单项点击
const handleItemClick = (item: MenuItem) => {
  switch (item.action) {
    case 'edit-model':
      emit('edit-model')
      break
    case 'duplicate-model':
      emit('duplicate-model')
      break
    case 'test-model':
      emit('test-model')
      break
    case 'delete-model':
      emit('delete-model')
      break
  }
}
</script>