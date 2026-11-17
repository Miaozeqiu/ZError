<template>
  <div class="file-tree-node">
    <div
      class="node-content"
      :class="{
        selected: isSelected,
        folder: node.type === 'folder',
        file: node.type === 'file',
      }"
      :style="{ paddingLeft: `${level * 16}px` }"
      :title="node.path || node.name"
      @click="handleClick"
    >
      <div class="level-lines">
        <div
          v-for="i in level"
          :key="i"
          class="level-line"
          :style="{ left: `${(i - 1) * 16 + 8}px` }"
        />
        <div
          v-if="level > 0"
          class="current-level-line"
          :style="{ left: `${(level - 1) * 16 + 8}px` }"
        />
      </div>

      <span
        v-if="node.type === 'folder'"
        class="expand-arrow"
        :class="{ expanded: isExpanded }"
        @click.stop="emit('toggle', node.id)"
      >
        <svg v-if="hasChildren" viewBox="0 0 12 12" width="12" height="12" fill="currentColor">
          <path d="M4.7 10c-.2 0-.4-.1-.5-.2-.3-.3-.3-.8 0-1.1L6.9 6 4.2 3.3c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l3.3 3.2c.3.3.3.8 0 1.1L5.3 9.7c-.2.2-.4.3-.6.3Z" />
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <circle cx="6" cy="6" r="2" />
        </svg>
      </span>
      <span v-else class="expand-arrow-placeholder" />

      <span class="node-icon">
        <FileTypeIcon
          v-if="node.type === 'folder'"
          folder
          :open="isExpanded && hasChildren"
          :icon="node.icon"
        />
        <FileTypeIcon v-else :name="node.name" :icon="node.icon" />
      </span>

      <span class="node-name">{{ node.name }}</span>
    </div>

    <div v-if="hasChildren" class="children-clip" :class="{ open: isExpanded }">
      <div class="children">
        <SkillFileTreeNode
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :level="level + 1"
          :selected-id="selectedId"
          :expanded="expanded"
          @select="emit('select', $event)"
          @toggle="emit('toggle', $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import FileTypeIcon from '../ui/FileTypeIcon.vue'

export type SkillFileTreeNodeData = {
  id: string
  name: string
  type: 'file' | 'folder'
  path?: string
  icon?: string
  children?: SkillFileTreeNodeData[]
}

const props = defineProps<{
  node: SkillFileTreeNodeData
  level: number
  selectedId: string
  expanded: Set<string>
}>()

const emit = defineEmits<{
  select: [path: string]
  toggle: [id: string]
}>()

const hasChildren = computed(() => Boolean(props.node.children?.length))
const isExpanded = computed(() => props.expanded.has(props.node.id))
const isSelected = computed(() => (
  props.node.type === 'file' && Boolean(props.node.path) && props.node.path === props.selectedId
))

const handleClick = () => {
  if (props.node.type === 'folder') {
    emit('toggle', props.node.id)
    return
  }
  if (props.node.path) emit('select', props.node.path)
}
</script>

<style scoped>
.file-tree-node {
  user-select: none;
  position: relative;
}

.node-content {
  display: flex;
  align-items: center;
  height: 32px;
  cursor: pointer;
  color: var(--filetree-node-text, var(--text-primary));
  font-size: 13px;
  white-space: nowrap;
  position: relative;
  padding-right: 8px;
  border-radius: 6px;
}

.node-content:hover {
  background-color: var(--filetree-node-hover-bg, var(--hover-bg, rgba(0, 0, 0, 0.04)));
}

.node-content.selected {
  background-color: var(--filetree-node-selected-bg, color-mix(in srgb, var(--color-accent, #667eea) 12%, transparent));
}

.level-lines {
  position: absolute;
  inset: 0 auto 0 0;
  pointer-events: none;
}

.level-line {
  position: absolute;
  top: 0;
  width: 0.5px;
  height: 100%;
  background-color: var(--filetree-level-line-color, rgba(0, 0, 0, 0.08));
}

.current-level-line {
  position: absolute;
  top: 0;
  width: 0.5px;
  height: 50%;
  background-color: var(--filetree-level-line-color, rgba(0, 0, 0, 0.08));
}

.children-clip {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms ease-out;
}

.children-clip.open {
  grid-template-rows: 1fr;
}

.children {
  min-height: 0;
  overflow: hidden;
}

.expand-arrow {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--filetree-expand-arrow-color, var(--text-secondary));
  transition: transform 200ms ease-out;
  flex-shrink: 0;
}

.expand-arrow.expanded {
  transform: rotate(90deg);
}

.expand-arrow-placeholder {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.node-icon {
  margin: 0 6px 0 4px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.node-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (prefers-reduced-motion: reduce) {
  .children-clip,
  .expand-arrow {
    transition: none;
  }
}
</style>
