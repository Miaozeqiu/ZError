<template>
  <div class="skill-file-tree">
    <SkillFileTreeNode
      v-for="item in tree"
      :key="item.id"
      :node="item"
      :level="0"
      :selected-id="selectedId"
      :expanded="expanded"
      @select="emit('select', $event)"
      @toggle="toggle"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SkillFileTreeNode, { type SkillFileTreeNodeData } from './SkillFileTreeNode.vue'

const PARSER_FOLDER_ICON = 'folder-type-js'

const props = defineProps<{
  files: string[]
  selected: string
}>()

const emit = defineEmits<{
  select: [path: string]
}>()

const buildTree = (files: string[]): SkillFileTreeNodeData[] => {
  type Mutable = SkillFileTreeNodeData & { children: Mutable[] }
  const root: Mutable[] = []
  const folders = new Map<string, Mutable>()

  const ensureFolder = (dir: string): Mutable => {
    const existing = folders.get(dir)
    if (existing) return existing
    const parts = dir.split('/').filter(Boolean)
    const name = parts[parts.length - 1] || dir
    const parentPath = parts.slice(0, -1).join('/')
    const isParserFolder = parts[0] === 'parsers'
    const node: Mutable = {
      id: `dir:${dir}`,
      name,
      type: 'folder',
      icon: isParserFolder ? PARSER_FOLDER_ICON : undefined,
      children: [],
    }
    folders.set(dir, node)
    if (parentPath) ensureFolder(parentPath).children.push(node)
    else root.push(node)
    return node
  }

  for (const file of files) {
    const parts = String(file || '').split('/').filter(Boolean)
    if (!parts.length) continue
    const name = parts[parts.length - 1] || file
    const dir = parts.slice(0, -1).join('/')
    const node: Mutable = { id: file, name, type: 'file', path: file, children: [] }
    if (dir) ensureFolder(dir).children.push(node)
    else root.push(node)
  }

  const sortNodes = (nodes: Mutable[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      if (a.name === 'index.js') return 1
      if (b.name === 'index.js') return -1
      const shared = (name: string) => /^(frames|catalog|video|parse|helpers)\.js$/i.test(name)
      if (shared(a.name) !== shared(b.name)) return shared(a.name) ? -1 : 1
      return a.name.localeCompare(b.name, 'zh')
    })
    nodes.forEach((item) => {
      if (item.children.length) sortNodes(item.children)
    })
  }
  sortNodes(root)
  return root
}

const tree = computed(() => buildTree(props.files))
const expanded = ref<Set<string>>(new Set())
const selectedId = computed(() => props.selected)

const expandAncestors = (nodes: SkillFileTreeNodeData[], target: string, path: string[] = []): string[] | null => {
  for (const node of nodes) {
    if (node.id === target || node.path === target) return path
    if (node.children?.length) {
      const found = expandAncestors(node.children, target, [...path, node.id])
      if (found) return found
    }
  }
  return null
}

const autoExpandFolders = (nodes: SkillFileTreeNodeData[], depth = 0, out: string[] = []) => {
  for (const node of nodes) {
    if (node.type !== 'folder') continue
    const parserChild = node.icon === PARSER_FOLDER_ICON && depth > 0
    if (!parserChild) out.push(node.id)
    if (node.children?.length && !parserChild) autoExpandFolders(node.children, depth + 1, out)
  }
  return out
}

watch(tree, (nodes) => {
  const next = new Set(expanded.value)
  autoExpandFolders(nodes).forEach((id) => next.add(id))
  expandAncestors(nodes, props.selected)?.forEach((id) => next.add(id))
  expanded.value = next
}, { immediate: true })

watch(() => props.selected, (path) => {
  const ancestors = expandAncestors(tree.value, path)
  if (!ancestors?.length) return
  const next = new Set(expanded.value)
  ancestors.forEach((id) => next.add(id))
  expanded.value = next
})

const toggle = (id: string) => {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}
</script>

<style scoped>
.skill-file-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 2px 6px 8px;
  user-select: none;
}
</style>
