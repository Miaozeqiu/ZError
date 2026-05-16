<template>
  <div v-if="visible" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel clear-confirm-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" type="button" @click="$emit('cancel')" title="取消">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">确认清除题目</h3>
        <button class="btn-danger-confirm" type="button" :disabled="loading" @click="$emit('confirm')">
          {{ loading ? '清除中...' : '清除' }}
        </button>
      </div>

      <div class="dialog-body">
        <div class="confirm-content">
          <div class="warning-icon">⚠️</div>
          <div class="message">
            <p>确定要清除文件夹 <strong>"{{ folderName }}"</strong> 下的所有题目吗？</p>
            <p>此操作会清除这个文件夹，以及文件夹下所有子文件夹下所有题目。</p>
            <p class="sub-message">文件夹结构会保留，此操作不可撤销。</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  visible: boolean;
  folderName: string;
  loading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  loading: false
});

const emit = defineEmits<{
  'confirm': [];
  'cancel': [];
}>();

const handleOverlayClick = () => {
  if (props.loading) return;
  emit('cancel');
};
</script>

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.clear-confirm-panel {
  max-width: 460px;
  display: flex;
  flex-direction: column;
}

.btn-danger-confirm {
  background: var(--dialog-button-danger-bg);
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  color: var(--dialog-button-danger-text);
  padding: 6px 14px;
  border-radius: 999px;
  transition: opacity 0.15s ease;
  flex-shrink: 0;
}

.btn-danger-confirm:hover:not(:disabled) {
  opacity: 0.85;
}

.btn-danger-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.confirm-content {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.warning-icon {
  font-size: 22px;
  flex-shrink: 0;
  line-height: 1.4;
}

.message p {
  margin: 0 0 6px 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--platform-config-dialog-title-text);
}

.sub-message {
  font-size: 12px !important;
  color: var(--text-secondary) !important;
  margin: 0 !important;
}
</style>
