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
import { computed } from 'vue';
import UnifiedContextMenu from '../../components/UnifiedContextMenu.vue';

interface Props {
  visible: boolean;
  x: number;
  y: number;
  isDefaultFolder?: boolean;
  isBlankArea?: boolean; // 新增：标识是否为空白区域右键
  canSetAsSaveFolder?: boolean;
  isCurrentSaveFolder?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'new-folder': [];
  'set-save-folder': [];
  'rename': [];
  'delete': [];
}>();

// 定义菜单项
const menuItems = computed(() => {
  // 如果是空白区域右键，只显示"新建文件夹"
  if (props.isBlankArea) {
    return [
      {
        id: 'new-folder',
        label: '新建文件夹',
        action: 'new-folder',
        icon: {
          type: 'emoji' as const,
          content: ''
        }
      }
    ];
  }

  const items: any[] = [
    {
      id: 'new-folder',
      label: '新建文件夹',
      action: 'new-folder',
      icon: {
        type: 'emoji' as const,
        content: ''
      }
    }
  ];

  if (props.canSetAsSaveFolder) {
    items.push(
      {
        id: 'set-save-folder',
        label: '设为保存文件夹',
        action: 'set-save-folder',
        icon: {
          type: 'emoji' as const,
          content: ''
        },
        disabled: props.isCurrentSaveFolder
      },
      {
        id: 'divider-1',
        type: 'divider' as const
      }
    );
  } else {
    items.push({
      id: 'divider-1',
      type: 'divider' as const
    });
  }

  items.push(
    {
      id: 'rename',
      label: '重命名',
      action: 'rename',
      icon: {
        type: 'emoji' as const,
        content: ''
      },
      disabled: props.isDefaultFolder
    },
    {
      id: 'delete',
      label: '删除',
      action: 'delete',
      icon: {
        type: 'emoji' as const,
        content: ''
      },
      disabled: props.isDefaultFolder,
      danger: true
    }
  );

  return items;
});

// 处理菜单项点击
const handleItemClick = (item: any) => {
  if (item.disabled) return;
  
  switch (item.action) {
    case 'new-folder':
      emit('new-folder');
      break;
    case 'set-save-folder':
      emit('set-save-folder');
      break;
    case 'rename':
      emit('rename');
      break;
    case 'delete':
      emit('delete');
      break;
  }
};
</script>
