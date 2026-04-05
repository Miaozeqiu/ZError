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
import UnifiedContextMenu, { type MenuItem } from '../../components/UnifiedContextMenu.vue'

interface Props {
  visible: boolean
  x: number
  y: number
  canPaste: boolean
  hasSelectedQuestion: boolean
  isBatchMode?: boolean
  selectedCount?: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'copy-question': []
  'copy-answer': []
  'copy': []
  'cut': []
  'paste': []
  'batch-copy': []
  'batch-cut': []
  'delete': []
  'batch-delete': []
}>()

// 定义菜单项
const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = []

  if (props.isBatchMode) {
    // 批量操作菜单
    items.push(
      {
        id: 'batch-header',
        label: `已选择 ${props.selectedCount} 个题目`,
        type: 'header'
      },
      { type: 'divider' },
      {
        id: 'batch-copy',
        label: '批量复制',
        action: 'batch-copy',
        icon: { type: 'emoji', content: '' }
      },
      {
        id: 'batch-cut',
        label: '批量剪切',
        action: 'batch-cut',
        icon: { type: 'emoji', content: '' }
      },
      {
        id: 'paste',
        label: '粘贴',
        action: 'paste',
        disabled: !props.canPaste,
        icon: { type: 'emoji', content: '' }
      },
      { type: 'divider' },
      {
        id: 'batch-delete',
        label: '批量删除',
        action: 'batch-delete',
        danger: true,
        icon: { type: 'emoji', content: '' }
      }
    )
  } else {
    // 单个题目操作菜单
    if (props.hasSelectedQuestion) {
      items.push(
        {
          id: 'copy-question',
          label: '复制题目',
          action: 'copy-question',
          icon: { type: 'emoji', content: '' }
        },
        {
          id: 'copy-answer',
          label: '复制答案',
          action: 'copy-answer',
          icon: { type: 'emoji', content: '' }
        },
        { type: 'divider' },
        {
          id: 'copy',
          label: '复制',
          action: 'copy',
          icon: { type: 'emoji', content: '' }
        },
        {
          id: 'cut',
          label: '剪切',
          action: 'cut',
          icon: { type: 'emoji', content: '' }
        }
      )
    }
    
    items.push({
      id: 'paste',
      label: '粘贴',
      action: 'paste',
      disabled: !props.canPaste,
      icon: { type: 'emoji', content: '' }
    })
    
    if (props.hasSelectedQuestion) {
      items.push(
        { type: 'divider' },
        {
          id: 'delete',
          label: '删除题目',
          action: 'delete',
          danger: true,
          icon: { type: 'emoji', content: '' }
        }
      )
    }
  }

  return items
})

// 处理菜单项点击
const handleItemClick = (item: MenuItem) => {
  switch (item.action) {
    case 'copy-question':
      emit('copy-question')
      break
    case 'copy-answer':
      emit('copy-answer')
      break
    case 'copy':
      emit('copy')
      break
    case 'cut':
      emit('cut')
      break
    case 'paste':
      emit('paste')
      break
    case 'batch-copy':
      emit('batch-copy')
      break
    case 'batch-cut':
      emit('batch-cut')
      break
    case 'delete':
      emit('delete')
      break
    case 'batch-delete':
      emit('batch-delete')
      break
  }
}
</script>
