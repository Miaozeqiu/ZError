<template>
  <aside class="chat-sidebar" :class="{ 'is-collapsed': chatListCollapsed }">
    <div class="pane-header">
      <div class="header-title">对话</div>
      <div class="header-actions">
        <button class="header-action" type="button" @click="() => createChat()">新对话</button>
        <button class="header-action" type="button" title="收起对话列表" @click="setChatListCollapsed(true)">收起</button>
      </div>
    </div>
    <div class="chat-list-wrap">
      <div ref="contentRef" class="chat-list">
        <div
          v-for="session in chatSessions"
          :key="session.id"
          class="chat-item"
          :class="{
            'is-selected': session.id === activeChatId,
            'is-running': isSessionRunning(session)
          }"
          @click="selectChat(session.id)"
        >
          <div class="chat-item-main">
            <div class="chat-item-name">{{ session.title || '新对话' }}</div>
          </div>
          <button
            class="chat-item-delete"
            type="button"
            title="删除对话"
            @click.stop="removeChat(session.id)"
          >
            <span class="chat-item-spinner" aria-hidden="true"></span>
            <svg class="chat-item-close" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <div v-if="!chatSessions.length" class="list-empty">还没有对话</div>
      </div>
      <div
        class="custom-scrollbar"
        :class="{ 'is-visible': visible }"
        ref="barRef"
        @mousedown="onMousedown"
      >
        <div class="custom-scrollbar-thumb" ref="thumbRef"></div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import {
  activeChatId,
  chatListCollapsed,
  chatSessions,
  createChat,
  removeChat,
  selectChat,
  setChatListCollapsed,
} from '../../services/agent/chat'
import type { AgentChatSession } from '../../services/agent/chat'
import { useCustomScrollbar } from '../../composables/useCustomScrollbar'

const {
  contentRef,
  barRef,
  thumbRef,
  visible,
  onMousedown,
  bind,
} = useCustomScrollbar()

const isSessionRunning = (session: AgentChatSession) =>
  session.messages.some((message) => message.status === 'streaming')

onMounted(() => bind())
</script>

<style scoped>
.chat-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
  transition: width 180ms cubic-bezier(0.23, 1, 0.32, 1),
    opacity 160ms cubic-bezier(0.23, 1, 0.32, 1),
    margin 180ms cubic-bezier(0.23, 1, 0.32, 1);
}

.chat-sidebar.is-collapsed {
  width: 0;
  min-width: 0;
  margin: 0;
  opacity: 0;
  pointer-events: none;
  border: none;
}

@media (prefers-reduced-motion: reduce) {
  .chat-sidebar {
    transition: none;
  }
}

.pane-header {
  position: relative;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.pane-header::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 1px;
  background: color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
  transform: scaleY(0.5);
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.header-action {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.header-action:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.chat-list-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.chat-list {
  position: absolute;
  inset: 0;
  overflow: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding: 4px 12px 4px 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  box-sizing: border-box;
}

.chat-list::-webkit-scrollbar,
.chat-list::-webkit-scrollbar-button {
  display: none;
}

.custom-scrollbar {
  position: absolute;
  right: 3px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  pointer-events: none;
  z-index: 2;
}

.custom-scrollbar.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.custom-scrollbar-thumb {
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.custom-scrollbar-thumb:hover,
.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--custom-scrollbar-thumb-hover);
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 5px 6px 5px 8px;
  min-height: 28px;
  cursor: pointer;
}

.chat-item:hover {
  background: var(--model-item-hover-bg, #efefef);
}

.chat-item.is-selected {
  background: var(--model-item-active-bg, var(--bg-tertiary, #e8e8ed));
}

.chat-item-main {
  flex: 1;
  min-width: 0;
}

.chat-item-name {
  font-size: 12px;
  line-height: 1.3;
  color: var(--text-primary, #2d3748);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-item-delete {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #718096);
  cursor: pointer;
  opacity: 0;
}

.chat-item:hover .chat-item-delete,
.chat-item.is-selected .chat-item-delete {
  opacity: 1;
}

.chat-item-delete:hover {
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
}

.chat-item-spinner {
  display: none;
  width: 12px;
  height: 12px;
  border: 1.5px solid color-mix(in srgb, var(--text-secondary, #718096) 28%, transparent);
  border-top-color: var(--text-secondary, #718096);
  border-radius: 50%;
  animation: chat-spin 0.7s linear infinite;
}

.chat-item-close {
  display: block;
}

.chat-item.is-running .chat-item-delete {
  opacity: 1;
}

.chat-item.is-running .chat-item-spinner {
  display: block;
}

.chat-item.is-running .chat-item-close {
  display: none;
}

.chat-item.is-running:hover .chat-item-spinner {
  display: none;
}

.chat-item.is-running:hover .chat-item-close {
  display: block;
}

@keyframes chat-spin {
  to { transform: rotate(360deg); }
}

.list-empty {
  color: var(--text-secondary, #718096);
  font-size: 13px;
  padding: 16px 10px;
}
</style>
