<template>
  <div
    class="homework-index"
    role="group"
    :aria-label="`作业题号，${summary}`"
    :style="{ '--index-width': `${Math.max(2, String(total).length)}ch` }"
  >
    <span>第</span>
    <button
      v-if="!editing"
      ref="button"
      class="homework-index-control"
      type="button"
      title="点击输入或左右拖动切换题目"
      :aria-label="`当前第 ${modelValue} 题，点击输入或左右拖动切换题目`"
      @pointerdown="startScrub"
      @pointermove="scrub"
      @pointerup="endScrub"
      @pointercancel="cancelScrub"
      @lostpointercapture="cancelScrub"
      @click="onClick"
      @keydown.left.prevent="changeIndex(modelValue - 1)"
      @keydown.right.prevent="changeIndex(modelValue + 1)"
      @keydown.home.prevent="changeIndex(1)"
      @keydown.end.prevent="changeIndex(total)"
    >{{ modelValue }}</button>
    <input
      v-else
      ref="input"
      v-model="draft"
      class="homework-index-control"
      type="text"
      inputmode="numeric"
      aria-label="输入要跳转的题号"
      @blur="finishEditing()"
      @keydown.enter.prevent="finishEditing(true)"
      @keydown.esc.stop.prevent="finishEditing(true, false)"
    />
    <span :title="summary">题，共 {{ total }} 题</span>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'

const props = defineProps<{ modelValue: number; total: number; summary: string }>()
const emit = defineEmits<{ 'update:modelValue': [index: number] }>()
const button = ref<HTMLButtonElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const editing = ref(false)
const draft = ref('')
let pointer: { id: number; x: number; index: number } | null = null
let dragged = false

const changeIndex = (value: number) => {
  const index = Math.max(1, Math.min(props.total, value))
  if (index !== props.modelValue) emit('update:modelValue', index)
}

const startScrub = (event: PointerEvent) => {
  if (event.button !== 0 || pointer) return
  pointer = { id: event.pointerId, x: event.clientX, index: props.modelValue }
  dragged = false
  const control = event.currentTarget as HTMLButtonElement
  control.setPointerCapture(event.pointerId)
}

const scrub = (event: PointerEvent) => {
  if (pointer?.id !== event.pointerId) return
  const distance = event.clientX - pointer.x
  if (Math.abs(distance) >= 5) dragged = true
  if (dragged) changeIndex(pointer.index + Math.trunc(distance / 12))
}

const endScrub = (event: PointerEvent) => {
  if (pointer?.id !== event.pointerId) return
  scrub(event)
  pointer = null
}

const cancelScrub = (event: PointerEvent) => {
  if (pointer?.id !== event.pointerId) return
  pointer = null
  dragged = true
}

const onClick = async (event: MouseEvent) => {
  if (dragged && event.detail !== 0) return
  draft.value = String(props.modelValue)
  editing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

const finishEditing = async (restoreFocus = false, commit = true) => {
  if (!editing.value) return
  editing.value = false
  const value = draft.value.trim()
  if (commit && /^\d+$/.test(value)) changeIndex(Number(value))
  if (restoreFocus) {
    await nextTick()
    button.value?.focus()
  }
}
</script>

<style scoped>
.homework-index { --index-fill: #f0f2f5; --index-active-fill: #ecf5ff; --index-color: #409eff; display: inline-flex; flex-shrink: 0; align-items: center; gap: 4px; color: var(--text-primary, #1d1d1f); font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-theme="dark"] .homework-index { --index-fill: #2b2b2b; --index-active-fill: #18253a; --index-color: #7ca8ff; }
.homework-index-control { box-sizing: content-box; width: var(--index-width); height: 22px; padding: 0 6px; border: 0; border-radius: 4px; background: var(--index-fill); color: var(--index-color); font: inherit; font-weight: 600; text-align: center; }
button.homework-index-control { cursor: ew-resize; touch-action: pan-y; user-select: none; }
button.homework-index-control:hover, button.homework-index-control:active, input.homework-index-control { background: var(--index-active-fill); }
.homework-index-control:focus-visible, input.homework-index-control { outline: 1px solid var(--index-color); outline-offset: 1px; }
</style>
