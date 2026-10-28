<template>
  <div ref="rootRef" class="settings-select">
    <button ref="triggerRef" :id="id" class="select-trigger" :class="{ open }" type="button" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="`${id}-options`" :aria-label="label" @click="toggle" @keydown="onTriggerKey">
      <span>{{ selectedLabel }}</span>
      <Icon class="select-arrow" icon="lucide:chevron-down" width="14" height="14" aria-hidden="true" />
    </button>
    <Teleport to="body">
      <Transition name="settings-select-pop" @before-leave="retireMenu">
        <div v-if="open" ref="menuRef" :id="`${id}-options`" class="select-menu" :class="{ 'opens-above': above }" :style="menuStyle" role="listbox" :aria-label="label" @keydown="onMenuKey">
          <button v-for="(option, index) in options" :key="option.value" type="button" class="select-option" :class="{ selected: option.value === modelValue }" role="option" :aria-selected="option.value === modelValue" :tabindex="index === focusedIndex ? 0 : -1" @focus="focusedIndex = index" @click="select(option.value)">
            <span>{{ option.label }}</span>
            <Icon v-if="option.value === modelValue" icon="lucide:check" width="14" height="14" aria-hidden="true" />
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import { createExclusiveMenuId, useExclusiveMenu } from '../../composables/useExclusiveMenu'

const props = defineProps<{ id: string; label: string; modelValue: string; options: ReadonlyArray<{ value: string; label: string }> }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const open = ref(false)
const above = ref(false)
const focusedIndex = ref(0)
const menuStyle = ref<Record<string, string>>({})
const selectedLabel = computed(() => props.options.find(option => option.value === props.modelValue)?.label || '')
useExclusiveMenu(createExclusiveMenuId('settings-select'), open)

// A fading menu may coexist briefly with a newly opened one. Retire its ID and
// interactions immediately so focus and aria-controls point only to the live menu.
const retireMenu = (element: Element) => {
  element.removeAttribute('id')
  element.setAttribute('aria-hidden', 'true')
  ;(element as HTMLElement).inert = true
}
const close = (restoreFocus = false) => {
  open.value = false
  if (restoreFocus) triggerRef.value?.focus({ preventScroll: true })
}
const focusOption = async (index: number) => {
  focusedIndex.value = Math.max(0, Math.min(index, props.options.length - 1))
  await nextTick()
  if (open.value) menuRef.value?.querySelectorAll<HTMLButtonElement>('[role="option"]')[focusedIndex.value]?.focus({ preventScroll: true })
}
const show = async (last = false) => {
  if (!props.options.length || !triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const width = Math.min(Math.max(rect.width, 160), window.innerWidth - 16)
  const height = Math.min(props.options.length * 34 + 16, 240, window.innerHeight - 16)
  above.value = rect.bottom + 6 + height > window.innerHeight - 8 && rect.top > window.innerHeight - rect.bottom
  const top = above.value ? rect.top - height - 6 : rect.bottom + 6
  menuStyle.value = {
    position: 'fixed', zIndex: '12000', width: `${width}px`,
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`,
    maxHeight: `${height}px`,
  }
  open.value = true
  const selected = props.options.findIndex(option => option.value === props.modelValue)
  await focusOption(selected >= 0 ? selected : last ? props.options.length - 1 : 0)
}
const toggle = () => { if (open.value) close(); else void show() }
const select = (value: string) => { emit('update:modelValue', value); close(true) }
const onTriggerKey = (event: KeyboardEvent) => {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault()
  void show(event.key === 'ArrowUp')
}
const onMenuKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') { event.preventDefault(); close(true); return }
  if (event.key === 'Tab') { close(true); return }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const option = props.options[focusedIndex.value]
    if (option) select(option.value)
    return
  }
  const offset = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
  if (offset || event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    void focusOption(event.key === 'Home' ? 0 : event.key === 'End' ? props.options.length - 1
      : (focusedIndex.value + offset + props.options.length) % props.options.length)
  }
}
const onOutside = (event: Event) => {
  if (event.target instanceof Node && (rootRef.value?.contains(event.target) || menuRef.value?.contains(event.target))) return
  close()
}
const onResize = () => close()
const cleanup = () => {
  document.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('scroll', onOutside, true)
  window.removeEventListener('resize', onResize)
}
watch(open, value => {
  cleanup()
  if (!value) return
  document.addEventListener('pointerdown', onOutside, true)
  window.addEventListener('scroll', onOutside, true)
  window.addEventListener('resize', onResize)
}, { flush: 'sync' })
onUnmounted(cleanup)
</script>

<style scoped>
.settings-select { min-width: 0; }
.select-trigger { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 38px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; background: var(--form-input-bg, #f7f7f7); color: var(--text-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; transition: border-color 160ms ease, background-color 160ms ease, transform 120ms ease; }
.select-trigger:hover, .select-trigger.open { background: var(--form-input-hover-bg, #f0f0f0); border-color: var(--form-input-hover-border, transparent); }
.select-trigger:focus-visible { outline: 2px solid var(--form-input-focus-border, #3182ce); outline-offset: 2px; }
.select-trigger:active { transform: scale(.97); }
.select-arrow { flex-shrink: 0; color: var(--text-secondary); transition: transform 160ms ease; }
.select-trigger.open .select-arrow { transform: rotate(180deg); }
.select-menu { box-sizing: border-box; display: flex; flex-direction: column; gap: 2px; overflow-y: auto; padding: 8px; border: 1px solid var(--context-menu-border, #ffffff8c); border-radius: 12px; background: var(--context-menu-bg, #ffffff66); backdrop-filter: blur(40px) saturate(180%); -webkit-backdrop-filter: blur(40px) saturate(180%); box-shadow: 0 12px 40px #00000038, 0 4px 12px #0000001f, inset 0 .5px 0 #ffffff80; }
.select-option { appearance: none; box-sizing: border-box; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 32px; padding: 4px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--context-menu-item-text, #2d3748); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.select-option:hover, .select-option.selected, .select-option:focus-visible { outline: none; background: var(--context-menu-item-hover-bg, #0000000f); }
.settings-select-pop-enter-active, .settings-select-pop-leave-active { transition: opacity 140ms ease, transform 160ms cubic-bezier(.2, .8, .2, 1); transform-origin: top center; }
.settings-select-pop-enter-active.opens-above, .settings-select-pop-leave-active.opens-above { transform-origin: bottom center; }
.settings-select-pop-leave-active { pointer-events: none; }
.settings-select-pop-enter-from, .settings-select-pop-leave-to { opacity: 0; transform: translateY(-4px) scale(.96); }
@media (prefers-reduced-motion: reduce) { .select-trigger, .select-arrow, .settings-select-pop-enter-active, .settings-select-pop-leave-active { transition: none; } }
@media (prefers-reduced-transparency: reduce) { .select-menu { backdrop-filter: none; -webkit-backdrop-filter: none; background: var(--bg-secondary, #fff); } }
</style>
