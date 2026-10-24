<template>
  <section v-if="cards.length" class="task-history" aria-label="任务历史">
    <article v-for="card in cards" :key="card.id" class="task-card">
      <div class="task-card-head">
        <span class="task-card-title" :title="card.title">{{ card.title }}</span>
        <span class="task-progress">{{ doneCount(card.todos) }}/{{ card.todos.length }}</span>
      </div>
      <ol aria-label="任务清单">
        <li v-for="(todo, index) in card.todos" :key="todo.id" :class="`is-${todo.status}`">
          <span class="task-number">{{ index + 1 }}.</span>
          <Icon :icon="todo.status === 'done' ? 'lucide:circle-check' : todo.status === 'cancelled' ? 'lucide:circle-minus' : 'lucide:circle'" width="14" height="14" aria-hidden="true" />
          <span class="task-text">{{ todo.text }}</span>
        </li>
      </ol>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import '../../utils/ui/agentIcons'
import { activeChat } from '../../services/agent/chatStore'
import type { AgentTodoItem } from '../../services/agent/chatTypes'
import { taskHistoryFor } from './taskHistory'

const cards = computed(() => taskHistoryFor(activeChat.value))
const doneCount = (todos: AgentTodoItem[]) => todos.filter(todo => todo.status === 'done').length
</script>

<style scoped>
.task-history { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; display: flex; flex-direction: column; gap: 10px; margin-top: 16px; padding: 1px 2px 16px; }
.task-card { flex-shrink: 0; padding: 11px 10px; border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 75%, transparent); border-radius: 10px; background: var(--bg-secondary, #fff); box-shadow: 0 3px 12px #0000000a; }
.task-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.task-card-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary, #2d3748); font-size: 12px; font-weight: 550; }
.task-progress { flex-shrink: 0; color: var(--text-secondary, #718096); font-size: 12px; font-variant-numeric: tabular-nums; }
.task-card ol { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.task-card li { display: flex; align-items: flex-start; gap: 5px; color: var(--text-primary, #2d3748); font-size: 12px; line-height: 1.65; }
.task-card li svg { flex-shrink: 0; margin-top: 3px; color: var(--text-secondary, #718096); }
.task-number { flex: 0 0 15px; color: var(--text-secondary, #718096); }
.task-text { min-width: 0; overflow-wrap: anywhere; }
.task-card li.is-done, .task-card li.is-cancelled { color: var(--text-secondary, #718096); }
.task-card li.is-cancelled .task-text { text-decoration: line-through; }
:global([data-theme="dark"]) .task-card { box-shadow: 0 3px 12px #00000026; }
</style>
