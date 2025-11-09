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
import type { AIPlatform } from '../services/modelConfig'

interface Props {
  visible: boolean
  x: number
  y: number
  platform?: AIPlatform | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'edit-platform': []
  'add-model': []
  'delete-platform': []
}>()

// 定义菜单项
const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [
    {
      id: 'edit-platform',
      label: '编辑平台',
      action: 'edit-platform',
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
      id: 'add-model',
      label: '添加模型',
      action: 'add-model',
      icon: {
        type: 'svg',
        paths: [
          { d: 'M12 5v14' },
          { d: 'M5 12h14' }
        ]
      }
    }
  ]

  // 只有非预定义平台才显示删除选项
  // 预定义平台ID列表
  const predefinedPlatformIds = ['siliconflow', 'aliyun-bailian']
  const isBuiltIn = props.platform && predefinedPlatformIds.includes(props.platform.id)
  
  if (!isBuiltIn) {
    items.push(
      { type: 'divider' },
      {
        id: 'delete-platform',
        label: '删除平台',
        action: 'delete-platform',
        danger: true,
        icon: {
          type: 'svg',
          polylines: [{ points: '3,6 5,6 21,6' }],
          paths: [{ d: 'M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2' }]
        }
      }
    )
  }

  return items
})

// 处理菜单项点击
const handleItemClick = (item: MenuItem) => {
  switch (item.action) {
    case 'edit-platform':
      emit('edit-platform')
      break
    case 'add-model':
      emit('add-model')
      break
    case 'delete-platform':
      emit('delete-platform')
      break
  }
}
</script>